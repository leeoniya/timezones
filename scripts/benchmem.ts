import { spawnSync } from "node:child_process";

import {
  getAvailableTimeZones,
  listTimeZonesAt,
  type TimeZoneStrategy,
} from "../dist/timezones.js";
import { TIME_ZONE_ABBREVIATIONS, type TimeZoneAbbreviationEntry } from "../dist/timezone-abbreviations.js";

interface StrategyConfig {
  formatterCount: (zones: string[]) => number;
}

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

const [strategyName, timestampArg] = process.argv.slice(2);
const timestamp = timestampArg === undefined ? Date.UTC(2026, 5, 30, 12) : Number(timestampArg);

if (!strategyName) {
  for (const name of Object.keys(strategies)) {
    const result = spawnSync(
      process.execPath,
      ["--expose-gc", "--experimental-strip-types", new URL(import.meta.url).pathname, name, String(timestamp)],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      },
    );

    process.stdout.write(result.stdout);

    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
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

if (!isTimeZoneStrategy(strategyName)) {
  console.error(`Unknown strategy "${strategyName}". Use: ${Object.keys(strategies).join(", ")}`);
  process.exit(1);
}

const strategy = strategies[strategyName];
const zones = getAvailableTimeZones();
const formatterCount = strategy.formatterCount(zones);

forceGc();
const before = process.memoryUsage();

const result = listTimeZonesAt(timestamp, strategyName);

forceGc();
const after = process.memoryUsage();
const delta = diffMemory(after, before);

console.log(`strategy: ${strategyName}`);
console.log(`timestamp: ${timestamp}`);
console.log(`zones: ${zones.length}`);
console.log(`estimated formatters: ${formatterCount}`);
console.log(`result length: ${result.length}`);
console.log("");
console.log("Memory delta after creating cached Intl.DateTimeFormat instances:");
printMemoryDelta("rss", delta.rss, formatterCount);
printMemoryDelta("heapTotal", delta.heapTotal, formatterCount);
printMemoryDelta("heapUsed", delta.heapUsed, formatterCount);
printMemoryDelta("external", delta.external, formatterCount);
printMemoryDelta("arrayBuffers", delta.arrayBuffers, formatterCount);
console.log("");
console.log("Absolute memory after measurement:");
printMemoryValue("rss", after.rss);
printMemoryValue("heapTotal", after.heapTotal);
printMemoryValue("heapUsed", after.heapUsed);
printMemoryValue("external", after.external);
printMemoryValue("arrayBuffers", after.arrayBuffers);
console.log("");

function isTimeZoneStrategy(value: string): value is TimeZoneStrategy {
  return value in strategies;
}

function forceGc(): void {
  for (let index = 0; index < 5; index += 1) {
    globalThis.gc?.();
  }
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
