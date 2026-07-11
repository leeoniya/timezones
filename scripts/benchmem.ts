import { spawnSync } from "node:child_process";

import {
  getAvailableTimeZones,
  getTimeZonesAt,
  type TimeZoneStrategy,
} from "../dist/timezones.js";
import { TIME_ZONE_ABBREVIATIONS, type TimeZoneAbbreviationEntry } from "../dist/timezone-abbreviations.js";

interface StrategyConfig {
  formatterCount: (zones: string[]) => number;
}

interface MemoryMeasurement {
  resultLength: number;
  delta: NodeJS.MemoryUsage;
  after: NodeJS.MemoryUsage;
}

type BenchmarkMode = "cold" | "prewarm" | "prewarm-bootstrap" | "prewarm-sample";

const strategies: Record<TimeZoneStrategy, StrategyConfig> = {
  conservative: {
    formatterCount: (zones) => zones.length,
  },
  balanced: {
    formatterCount: (zones) => countGroups(zones, () => true),
  },
  fastest: {
    formatterCount: (zones) => countGroups(zones, (entry) => Object.keys(entry).length > 1),
  },
};
const DEFAULT_SAMPLE_COUNT = 21;

const [strategyName, timestampArg, modeArg] = process.argv.slice(2);
const timestamp = timestampArg === undefined ? Date.UTC(2026, 5, 30, 12) : Number(timestampArg);

if (!strategyName) {
  const sampleCount = Number.parseInt(process.env.BENCHMEM_SAMPLES ?? String(DEFAULT_SAMPLE_COUNT), 10);

  if (!Number.isInteger(sampleCount) || sampleCount <= 0) {
    console.error(`BENCHMEM_SAMPLES must be a positive integer, got "${process.env.BENCHMEM_SAMPLES ?? ""}".`);
    process.exit(1);
  }

  const bootstrapResult = spawnSync(
    process.execPath,
    [
      "--expose-gc",
      "--experimental-strip-types",
      new URL(import.meta.url).pathname,
      "bootstrap",
      String(timestamp),
      "prewarm-bootstrap",
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );

  process.stdout.write(bootstrapResult.stdout);

  if (bootstrapResult.status !== 0) {
    process.exit(bootstrapResult.status ?? 1);
  }

  for (const name of Object.keys(strategies)) {
    printDeterministicPrewarmSummary(name, timestamp, sampleCount);
  }

  process.exit(0);
}

if (typeof globalThis.gc !== "function") {
  console.error("Run with: node --expose-gc --experimental-strip-types scripts/benchmem.ts");
  process.exit(1);
}

if (!Number.isFinite(timestamp)) {
  console.error("Timestamp must be a numeric UTC millisecond value.");
  process.exit(1);
}

const mode = modeArg === undefined ? "cold" : modeArg;

if (!isBenchmarkMode(mode)) {
  console.error(`Unknown mode "${mode}". Use: cold, prewarm, prewarm-bootstrap, prewarm-sample.`);
  process.exit(1);
}

if (strategyName === "bootstrap") {
  if (mode !== "prewarm-bootstrap") {
    console.error(`Strategy "bootstrap" only supports mode "prewarm-bootstrap".`);
    process.exit(1);
  }

  console.log("measurement: intl-prewarm-bootstrap");
  console.log(`mode: ${mode}`);
  console.log(`timestamp: ${timestamp}`);
  runPrewarmBootstrapBenchmark(timestamp);
  process.exit(0);
}

if (!isTimeZoneStrategy(strategyName)) {
  console.error(`Unknown strategy "${strategyName}". Use: ${Object.keys(strategies).join(", ")}`);
  process.exit(1);
}

const strategy = strategies[strategyName];
const zones = getAvailableTimeZones();
const formatterCount = strategy.formatterCount(zones);

if (mode === "prewarm-sample") {
  const measurement = measurePrewarmed(strategyName, timestamp);
  process.stdout.write(JSON.stringify(measurement));
  process.exit(0);
}

console.log(`strategy: ${strategyName}`);
console.log(`mode: ${mode}`);
console.log(`timestamp: ${timestamp}`);
console.log(`zones: ${zones.length}`);
console.log(`estimated formatters: ${formatterCount}`);

if (mode === "cold") {
  runColdBenchmark(strategyName, formatterCount, timestamp);
} else {
  runPrewarmedBenchmark(strategyName, formatterCount, timestamp);
}

function runColdBenchmark(strategyName: TimeZoneStrategy, formatterCount: number, timestamp: number): void {
  const measurement = measureCold(strategyName, timestamp);

  console.log(`result length: ${measurement.resultLength}`);
  console.log("");
  console.log("Memory delta for first getTimeZonesAt call (cold process):");
  printMemoryDelta("rss", measurement.delta.rss, formatterCount);
  printMemoryDelta("heapTotal", measurement.delta.heapTotal, formatterCount);
  printMemoryDelta("heapUsed", measurement.delta.heapUsed, formatterCount);
  printMemoryDelta("external", measurement.delta.external, formatterCount);
  printMemoryDelta("arrayBuffers", measurement.delta.arrayBuffers, formatterCount);
  console.log("");
  console.log("Absolute memory after cold measurement:");
  printMemoryValue("rss", measurement.after.rss);
  printMemoryValue("heapTotal", measurement.after.heapTotal);
  printMemoryValue("heapUsed", measurement.after.heapUsed);
  printMemoryValue("external", measurement.after.external);
  printMemoryValue("arrayBuffers", measurement.after.arrayBuffers);
  console.log("");
}

function runPrewarmedBenchmark(strategyName: TimeZoneStrategy, formatterCount: number, timestamp: number): void {
  const measurement = measurePrewarmed(strategyName, timestamp);

  console.log(`result length: ${measurement.resultLength}`);
  console.log("");
  console.log("Memory delta for getTimeZonesAt after Intl prewarm:");
  printMemoryDelta("rss", measurement.delta.rss, formatterCount);
  printMemoryDelta("heapTotal", measurement.delta.heapTotal, formatterCount);
  printMemoryDelta("heapUsed", measurement.delta.heapUsed, formatterCount);
  printMemoryDelta("external", measurement.delta.external, formatterCount);
  printMemoryDelta("arrayBuffers", measurement.delta.arrayBuffers, formatterCount);
  console.log("");
  console.log("Absolute memory after prewarmed measurement:");
  printMemoryValue("rss", measurement.after.rss);
  printMemoryValue("heapTotal", measurement.after.heapTotal);
  printMemoryValue("heapUsed", measurement.after.heapUsed);
  printMemoryValue("external", measurement.after.external);
  printMemoryValue("arrayBuffers", measurement.after.arrayBuffers);
  console.log("");
}

function printDeterministicPrewarmSummary(
  strategyName: string,
  timestamp: number,
  sampleCount: number,
): void {
  if (!isTimeZoneStrategy(strategyName)) {
    throw new Error(`Unknown strategy "${strategyName}".`);
  }

  const zones = getAvailableTimeZones();
  const formatterCount = strategies[strategyName].formatterCount(zones);
  const samples: MemoryMeasurement[] = [];

  for (let index = 0; index < sampleCount; index += 1) {
    const result = spawnSync(
      process.execPath,
      [
        "--expose-gc",
        "--experimental-strip-types",
        new URL(import.meta.url).pathname,
        strategyName,
        String(timestamp),
        "prewarm-sample",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      },
    );

    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }

    const output = result.stdout.trim();

    if (!output) {
      throw new Error(`No sample output for strategy "${strategyName}".`);
    }

    samples.push(JSON.parse(output) as MemoryMeasurement);
  }

  const medianMeasurement = selectMedianMeasurement(samples, "rss");

  console.log(`strategy: ${strategyName}`);
  console.log("mode: prewarm");
  console.log(`timestamp: ${timestamp}`);
  console.log(`zones: ${zones.length}`);
  console.log(`estimated formatters: ${formatterCount}`);
  console.log(`samples: ${sampleCount} (median by rss)`);
  console.log(`result length: ${medianMeasurement.resultLength}`);
  console.log("");
  console.log("Memory delta for getTimeZonesAt after Intl prewarm:");
  printMemoryDelta("rss", medianMeasurement.delta.rss, formatterCount);
  printMemoryDelta("heapTotal", medianMeasurement.delta.heapTotal, formatterCount);
  printMemoryDelta("heapUsed", medianMeasurement.delta.heapUsed, formatterCount);
  printMemoryDelta("external", medianMeasurement.delta.external, formatterCount);
  printMemoryDelta("arrayBuffers", medianMeasurement.delta.arrayBuffers, formatterCount);
  console.log("");
}

function runPrewarmBootstrapBenchmark(timestamp: number): void {
  forceGc();
  const before = process.memoryUsage();

  prewarmIntl(timestamp);

  forceGc();
  const after = process.memoryUsage();
  const delta = diffMemory(after, before);

  console.log("");
  console.log("Memory delta for Intl prewarm bootstrap:");
  printMemoryDelta("rss", delta.rss, 1);
  printMemoryDelta("heapTotal", delta.heapTotal, 1);
  printMemoryDelta("heapUsed", delta.heapUsed, 1);
  printMemoryDelta("external", delta.external, 1);
  printMemoryDelta("arrayBuffers", delta.arrayBuffers, 1);
  console.log("");
}

function isTimeZoneStrategy(value: string): value is TimeZoneStrategy {
  return value in strategies;
}

function isBenchmarkMode(value: string): value is BenchmarkMode {
  return value === "cold" || value === "prewarm" || value === "prewarm-bootstrap" || value === "prewarm-sample";
}

function forceGc(): void {
  for (let index = 0; index < 5; index += 1) {
    globalThis.gc?.();
  }
}

function prewarmIntl(timestamp: number): void {
  const date = new Date(timestamp);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    timeZoneName: "shortOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  formatter.format(date);
}

function countGroups(
  zones: string[],
  shouldGroup: (entry: TimeZoneAbbreviationEntry) => boolean,
): number {
  const groups = new Set<string>();

  for (const timeZone of zones) {
    const entry = TIME_ZONE_ABBREVIATIONS[timeZone];

    if (shouldGroup(entry)) {
      groups.add(JSON.stringify(entry));
    }
  }

  return groups.size;
}

function diffMemory(
  after: NodeJS.MemoryUsage,
  before: NodeJS.MemoryUsage,
): NodeJS.MemoryUsage {
  return Object.fromEntries(
    Object.entries(after).map(([key, value]) => [key, value - before[key as keyof NodeJS.MemoryUsage]]),
  ) as NodeJS.MemoryUsage;
}

function measureCold(
  strategyName: TimeZoneStrategy,
  timestamp: number,
): MemoryMeasurement {
  forceGc();
  const before = process.memoryUsage();

  const result = getTimeZonesAt(timestamp, strategyName);

  forceGc();
  const after = process.memoryUsage();

  return {
    resultLength: result.length,
    delta: diffMemory(after, before),
    after,
  };
}

function measurePrewarmed(
  strategyName: TimeZoneStrategy,
  timestamp: number,
): MemoryMeasurement {
  prewarmIntl(timestamp);

  forceGc();
  const before = process.memoryUsage();

  const result = getTimeZonesAt(timestamp, strategyName);

  forceGc();
  const after = process.memoryUsage();

  return {
    resultLength: result.length,
    delta: diffMemory(after, before),
    after,
  };
}

function selectMedianMeasurement(
  samples: MemoryMeasurement[],
  key: keyof NodeJS.MemoryUsage,
): MemoryMeasurement {
  const sorted = [...samples].sort((left, right) => left.delta[key] - right.delta[key]);

  if (sorted.length === 0) {
    throw new Error("No measurements available to compute median.");
  }

  return sorted[Math.floor(sorted.length / 2)]!;
}

function printMemoryDelta(name: string, bytes: number, count: number): void {
  const perFormatter = count === 0 ? "n/a" : `${formatBytes(bytes / count)} per formatter`;

  console.log(`${name}: ${formatBytes(bytes)} (${perFormatter})`);
}

function printMemoryValue(name: string, bytes: number): void {
  console.log(`${name}: ${formatBytes(bytes)}`);
}

function formatBytes(bytes: number): string {
  const sign = bytes < 0 ? "-" : "";
  const absolute = Math.abs(bytes);

  if (absolute < 1024) {
    return `${sign}${absolute.toFixed(0)} B`;
  }

  if (absolute < 1024 * 1024) {
    return `${sign}${(absolute / 1024).toFixed(1)} KiB`;
  }

  return `${sign}${(absolute / 1024 / 1024).toFixed(2)} MiB`;
}
