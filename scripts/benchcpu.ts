import { Bench } from "tinybench";

import {
  getAvailableTimeZones,
  getTimeZonesAt,
  type TimeZoneStrategy,
} from "../dist/timezones.js";

const iterations = Number.parseInt(process.argv[2] ?? "50", 10);
const timestamp = Date.UTC(2026, 5, 30, 12);
const zones = getAvailableTimeZones();
const start = Date.UTC(2026, 0, 1, 0);
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_SECOND = 1000;
const SECONDS_PER_HOUR = 60 * 60;
let sink = 0;
const strategies: TimeZoneStrategy[] = [
  "conservative",
  "balanced",
  "fastest",
];

console.log(`zones: ${zones.length}`);
console.log(`iterations: ${iterations}`);

for (const strategy of strategies) {
  const cold = measure(() => getTimeZonesAt(timestamp, strategy));
  const coldResult = getTimeZonesAt(timestamp, strategy);

  console.log(`${strategy} cold full list: ${formatMs(cold)} ms`);
  console.log(`${strategy} result length: ${coldResult.length}`);
}

const bench = new Bench({
  iterations,
  time: 0,
  warmupIterations: 10,
  warmupTime: 0,
});

for (const strategy of strategies) {
  let missIndex = 0;
  let hitIndex = 0;

  bench
    .add(`${strategy} warm within-hour cache hit`, () => {
      const withinHourOffsetMs = (hitIndex % SECONDS_PER_HOUR) * MS_PER_SECOND;
      const timestampMs = start + withinHourOffsetMs;
      hitIndex = (hitIndex + 1) % iterations;
      sink += getTimeZonesAt(timestampMs, strategy).length;
    })
    .add(`${strategy} warm forced cache miss`, () => {
      const timestampMs = start + missIndex * MS_PER_HOUR;
      missIndex = (missIndex + 1) % iterations;
      sink += getTimeZonesAt(timestampMs, strategy).length;
    });
}

await bench.run();

for (const task of bench.tasks) {
  const result = task.result;

  if (result.state !== "completed") {
    console.log(`${task.name}: ${result.state}`);
    continue;
  }

  console.log(
    `${task.name}: avg ${formatMs(result.latency.mean)} ms, min ${formatMs(
      result.latency.min,
    )} ms, max ${formatMs(result.latency.max)} ms, hz ${Math.round(result.throughput.mean)}`,
  );
}

// Prevent engines from proving benchmark work unused.
if (sink === 0) {
  console.error("benchmark produced no results");
  process.exitCode = 1;
}

function measure(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

function formatMs(value: number): string {
  return value.toFixed(3);
}
