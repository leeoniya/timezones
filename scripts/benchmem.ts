import { spawnSync } from "node:child_process";

import {
  getAvailableTimeZones,
  getTimeZonesAt,
} from "../dist/timezones.js";
import { TIME_ZONE_ABBREVIATIONS, type TimeZoneAbbreviationEntry } from "../dist/timezone-abbreviations.js";
import { TIME_ZONE_ALIAS_GROUPS } from "../dist/timezone-aliases.js";

interface MemoryMeasurement {
  resultLength: number;
  delta: NodeJS.MemoryUsage;
  after: NodeJS.MemoryUsage;
}

type BenchmarkMode = "cold" | "prewarm" | "prewarm-bootstrap" | "prewarm-sample";
const DEFAULT_SAMPLE_COUNT = 21;
const ALIAS_TO_CANONICAL = createAliasToCanonicalMap();
const DEFAULT_TIMESTAMP = Date.UTC(2026, 5, 30, 12);
const INTERNAL_BOOTSTRAP_ENV = "BENCHMEM_INTERNAL_BOOTSTRAP";

const args = process.argv.slice(2);
const isInternalBootstrap = process.env[INTERNAL_BOOTSTRAP_ENV] === "1";
const timestampArg = args[0];
const modeArg = args[1];
const timestamp =
  timestampArg === undefined || isBenchmarkMode(timestampArg)
    ? DEFAULT_TIMESTAMP
    : Number(timestampArg);

if (!isInternalBootstrap && args.length === 0) {
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
      String(timestamp),
      "prewarm-bootstrap",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        [INTERNAL_BOOTSTRAP_ENV]: "1",
      },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );

  process.stdout.write(bootstrapResult.stdout);

  if (bootstrapResult.status !== 0) {
    process.exit(bootstrapResult.status ?? 1);
  }

  printDeterministicPrewarmSummary(timestamp, sampleCount);

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

const mode = timestampArg !== undefined && isBenchmarkMode(timestampArg)
  ? timestampArg
  : (modeArg ?? "cold");

if (timestampArg !== undefined && isBenchmarkMode(timestampArg)) {
  const inferredMode = timestampArg;

  if (modeArg !== undefined) {
    console.error(`Mode "${inferredMode}" does not accept a second positional argument.`);
    process.exit(1);
  }
}

if (!isBenchmarkMode(mode)) {
  console.error(`Unknown mode "${mode}". Use: cold, prewarm, prewarm-bootstrap, prewarm-sample.`);
  process.exit(1);
}

if (isInternalBootstrap) {
  if (mode !== "prewarm-bootstrap") {
    console.error(`Internal bootstrap only supports mode "prewarm-bootstrap".`);
    process.exit(1);
  }

  const rows: Array<[string, string]> = [
    ["measurement", "intl-prewarm-bootstrap"],
    ["mode", mode],
    ["timestamp", String(timestamp)],
    ...runPrewarmBootstrapBenchmark(timestamp),
  ];
  printMarkdownTable(rows);
  process.exit(0);
}

const zones = getAvailableTimeZones();
const formatterCount = getRuntimeFormatterCount(zones);

if (mode === "prewarm-sample") {
  const measurement = measurePrewarmed(timestamp);
  process.stdout.write(JSON.stringify(measurement));
  process.exit(0);
}

const rows: Array<[string, string]> = [
  ["implementation", "runtime"],
  ["mode", mode],
  ["timestamp", String(timestamp)],
  ["zones", String(zones.length)],
  ["estimated formatters", String(formatterCount)],
  ...(mode === "cold"
    ? runColdBenchmark(formatterCount, timestamp)
    : runPrewarmedBenchmark(formatterCount, timestamp)),
];

printMarkdownTable(rows);

function runColdBenchmark(formatterCount: number, timestamp: number): Array<[string, string]> {
  const measurement = measureCold(timestamp);

  return [
    ["result length", String(measurement.resultLength)],
    ["memory delta (cold) rss", formatMemoryDelta(measurement.delta.rss, formatterCount)],
    ["memory delta (cold) heapTotal", formatMemoryDelta(measurement.delta.heapTotal, formatterCount)],
    ["memory delta (cold) heapUsed", formatMemoryDelta(measurement.delta.heapUsed, formatterCount)],
    ["memory delta (cold) external", formatMemoryDelta(measurement.delta.external, formatterCount)],
    ["memory delta (cold) arrayBuffers", formatMemoryDelta(measurement.delta.arrayBuffers, formatterCount)],
    ["absolute memory (cold) rss", formatBytes(measurement.after.rss)],
    ["absolute memory (cold) heapTotal", formatBytes(measurement.after.heapTotal)],
    ["absolute memory (cold) heapUsed", formatBytes(measurement.after.heapUsed)],
    ["absolute memory (cold) external", formatBytes(measurement.after.external)],
    ["absolute memory (cold) arrayBuffers", formatBytes(measurement.after.arrayBuffers)],
  ];
}

function runPrewarmedBenchmark(formatterCount: number, timestamp: number): Array<[string, string]> {
  const measurement = measurePrewarmed(timestamp);

  return [
    ["result length", String(measurement.resultLength)],
    ["memory delta (prewarm) rss", formatMemoryDelta(measurement.delta.rss, formatterCount)],
    ["memory delta (prewarm) heapTotal", formatMemoryDelta(measurement.delta.heapTotal, formatterCount)],
    ["memory delta (prewarm) heapUsed", formatMemoryDelta(measurement.delta.heapUsed, formatterCount)],
    ["memory delta (prewarm) external", formatMemoryDelta(measurement.delta.external, formatterCount)],
    ["memory delta (prewarm) arrayBuffers", formatMemoryDelta(measurement.delta.arrayBuffers, formatterCount)],
    ["absolute memory (prewarm) rss", formatBytes(measurement.after.rss)],
    ["absolute memory (prewarm) heapTotal", formatBytes(measurement.after.heapTotal)],
    ["absolute memory (prewarm) heapUsed", formatBytes(measurement.after.heapUsed)],
    ["absolute memory (prewarm) external", formatBytes(measurement.after.external)],
    ["absolute memory (prewarm) arrayBuffers", formatBytes(measurement.after.arrayBuffers)],
  ];
}

function printDeterministicPrewarmSummary(
  timestamp: number,
  sampleCount: number,
): void {
  const zones = getAvailableTimeZones();
  const formatterCount = getRuntimeFormatterCount(zones);
  const samples: MemoryMeasurement[] = [];

  for (let index = 0; index < sampleCount; index += 1) {
    const result = spawnSync(
      process.execPath,
      [
        "--expose-gc",
        "--experimental-strip-types",
        new URL(import.meta.url).pathname,
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
      throw new Error('No sample output for implementation "runtime".');
    }

    samples.push(JSON.parse(output) as MemoryMeasurement);
  }

  const medianMeasurement = selectMedianMeasurement(samples, "rss");

  printMarkdownTable([
    ["implementation", "runtime"],
    ["mode", "prewarm"],
    ["timestamp", String(timestamp)],
    ["zones", String(zones.length)],
    ["estimated formatters", String(formatterCount)],
    ["samples", `${sampleCount} (median by rss)`],
    ["result length", String(medianMeasurement.resultLength)],
    ["memory delta (prewarm) rss", formatMemoryDelta(medianMeasurement.delta.rss, formatterCount)],
    ["memory delta (prewarm) heapTotal", formatMemoryDelta(medianMeasurement.delta.heapTotal, formatterCount)],
    ["memory delta (prewarm) heapUsed", formatMemoryDelta(medianMeasurement.delta.heapUsed, formatterCount)],
    ["memory delta (prewarm) external", formatMemoryDelta(medianMeasurement.delta.external, formatterCount)],
    ["memory delta (prewarm) arrayBuffers", formatMemoryDelta(medianMeasurement.delta.arrayBuffers, formatterCount)],
  ]);
}

function runPrewarmBootstrapBenchmark(timestamp: number): Array<[string, string]> {
  forceGc();
  const before = process.memoryUsage();

  prewarmIntl(timestamp);

  forceGc();
  const after = process.memoryUsage();
  const delta = diffMemory(after, before);

  return [
    ["memory delta (bootstrap) rss", formatMemoryDelta(delta.rss, 1)],
    ["memory delta (bootstrap) heapTotal", formatMemoryDelta(delta.heapTotal, 1)],
    ["memory delta (bootstrap) heapUsed", formatMemoryDelta(delta.heapUsed, 1)],
    ["memory delta (bootstrap) external", formatMemoryDelta(delta.external, 1)],
    ["memory delta (bootstrap) arrayBuffers", formatMemoryDelta(delta.arrayBuffers, 1)],
  ];
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
    const entry = getEntryForZone(timeZone);

    if (!entry) {
      throw new Error(`No abbreviation entry found for "${timeZone}".`);
    }

    if (shouldGroup(entry)) {
      groups.add(JSON.stringify(entry));
    }
  }

  return groups.size;
}

function getRuntimeFormatterCount(zones: string[]): number {
  return countGroups(zones, (entry) => Object.keys(entry).length > 1);
}

function createAliasToCanonicalMap(): ReadonlyMap<string, string> {
  const aliasToCanonical = new Map<string, string>();

  for (const [canonical, ...aliases] of TIME_ZONE_ALIAS_GROUPS) {
    for (const alias of aliases) {
      aliasToCanonical.set(alias, canonical);
    }
  }

  return aliasToCanonical;
}

function getEntryForZone(timeZone: string): TimeZoneAbbreviationEntry | undefined {
  const direct = TIME_ZONE_ABBREVIATIONS[timeZone];

  if (direct) {
    return direct;
  }

  const canonical = ALIAS_TO_CANONICAL.get(timeZone);

  return canonical ? TIME_ZONE_ABBREVIATIONS[canonical] : undefined;
}

function diffMemory(
  after: NodeJS.MemoryUsage,
  before: NodeJS.MemoryUsage,
): NodeJS.MemoryUsage {
  return Object.fromEntries(
    Object.entries(after).map(([key, value]) => [key, value - before[key as keyof NodeJS.MemoryUsage]]),
  ) as NodeJS.MemoryUsage;
}

function measureCold(timestamp: number): MemoryMeasurement {
  forceGc();
  const before = process.memoryUsage();

  const result = getTimeZonesAt(timestamp);

  forceGc();
  const after = process.memoryUsage();

  return {
    resultLength: result.length,
    delta: diffMemory(after, before),
    after,
  };
}

function measurePrewarmed(timestamp: number): MemoryMeasurement {
  prewarmIntl(timestamp);

  forceGc();
  const before = process.memoryUsage();

  const result = getTimeZonesAt(timestamp);

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

function formatMemoryDelta(bytes: number, count: number): string {
  const perFormatter = count === 0 ? "n/a" : `${formatBytes(bytes / count)} per formatter`;
  return `${formatBytes(bytes)} (${perFormatter})`;
}

function printMarkdownTable(rows: Array<[string, string]>): void {
  const escapedRows = rows.map(([heading, value]) => [escapeMarkdownCell(heading), escapeMarkdownCell(value)] as const);
  const headingWidth = Math.max(...escapedRows.map(([heading]) => heading.length));
  const valueWidth = Math.max(...escapedRows.map(([, value]) => value.length));

  for (const [heading, value] of escapedRows) {
    console.log(`| ${heading.padEnd(headingWidth)} | ${value.padEnd(valueWidth)} |`);
  }
}

function escapeMarkdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", "<br>");
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
