import { Bench } from "tinybench";

import {
  getAvailableTimeZones,
  getTimeZonesAt,
} from "../dist/timezones.js";

const iterations = Number.parseInt(process.argv[2] ?? "50", 10);
const timestamp = Date.UTC(2026, 5, 30, 12);
const zones = getAvailableTimeZones();
const start = Date.UTC(2026, 0, 1, 0);
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_SECOND = 1000;
const SECONDS_PER_HOUR = 60 * 60;
let sink = 0;
const rows: Array<[string, string]> = [
  ["zones", String(zones.length)],
  ["iterations", String(iterations)],
];

const cold = measure(() => getTimeZonesAt(timestamp));
const coldResult = getTimeZonesAt(timestamp);
rows.push(["cold full list", `${formatMs(cold)} ms`]);
rows.push(["result length", String(coldResult.length)]);

const bench = new Bench({
  iterations,
  time: 0,
  warmupIterations: 10,
  warmupTime: 0,
});

let missIndex = 0;
let hitIndex = 0;

bench
  .add("warm within-hour cache hit", () => {
    const withinHourOffsetMs = (hitIndex % SECONDS_PER_HOUR) * MS_PER_SECOND;
    const timestampMs = start + withinHourOffsetMs;
    hitIndex = (hitIndex + 1) % iterations;
    sink += getTimeZonesAt(timestampMs).length;
  })
  .add("warm forced cache miss", () => {
    const timestampMs = start + missIndex * MS_PER_HOUR;
    missIndex = (missIndex + 1) % iterations;
    sink += getTimeZonesAt(timestampMs).length;
  });

await bench.run();

for (const task of bench.tasks) {
  const result = task.result;

  if (result.state !== "completed") {
    rows.push([task.name, result.state]);
    continue;
  }

  rows.push([task.name, `${formatMs(result.latency.mean)} ms`]);
}

printMarkdownTable(rows);

// Prevent engines from proving benchmark work unused.
if (sink === 0) {
  console.error("benchmark produced no results");
  process.exitCode = 1;
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

function measure(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

function formatMs(value: number): string {
  return value.toFixed(3);
}
