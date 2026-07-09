import { Bench } from "tinybench";

import {
  getAvailableTimeZones,
  listTimeZonesAt,
  type TimeZoneStrategy,
} from "../dist/timezones.js";

const iterations = Number.parseInt(process.argv[2] ?? "50", 10);
const timestamp = Date.UTC(2026, 5, 30, 12);
const zones = getAvailableTimeZones();
const start = Date.UTC(2026, 0, 1, 0);
const changingTimestampIndexes = new Map<TimeZoneStrategy, number>();
let sink = 0;
const strategies: TimeZoneStrategy[] = [
  "conservative",
  "balanced",
  "fastest",
];

console.log(`zones: ${zones.length}`);
console.log(`iterations: ${iterations}`);

for (const strategy of strategies) {
  const cold = measure(() => listTimeZonesAt(timestamp, strategy));
  const coldResult = listTimeZonesAt(timestamp, strategy);

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
  changingTimestampIndexes.set(strategy, 0);

  bench
    .add(`${strategy} warm changing timestamp`, () => {
      const index = changingTimestampIndexes.get(strategy) ?? 0;
      const timestampMs = start + index * 60 * 60 * 1000;

      changingTimestampIndexes.set(strategy, (index + 1) % iterations);
      sink += listTimeZonesAt(timestampMs, strategy).length;
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
