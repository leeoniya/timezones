# Timezones

Dependency-free TypeScript utility for listing available IANA time zones with
their short names and UTC offsets at a specific instant.

## Why this exists

Many applications need a compact list of current-ish IANA zones with short
abbreviations and UTC offsets, but common options have tradeoffs:

- `moment-timezone` ships a large database because it includes deep historical
  transition data.
- `Intl` can provide offsets, but it cannot reliably provide common short
  abbreviations (for example standard/daylight variants like `EST`/`EDT` or
  `NZST`/`NZDT`) in a stable cross-runtime way.

This project keeps runtime usage light by generating a compact lookup from
pinned IANA tzdb data, then using `Intl` only for timestamp-specific offset
resolution.

```ts
import { getTimeZonesAt } from "./src";

const zones = getTimeZonesAt(Date.UTC(2024, 6, 15, 12));

console.log(zones.find((zone) => zone.name === "America/New_York"));
// {
//   name: "America/New_York",
//   abbr: "EDT",
//   offset: "-04:00"
// }
```

## API

### `getTimeZonesAt(timestamp)`

Returns one entry per time zone:

```ts
interface TimeZoneInfo {
  name: string;
  abbr: string;
  offset: string;
  aliasOf?: string;
}
```

`timestamp` is a numeric UTC millisecond timestamp.

```ts
getTimeZonesAt(Date.UTC(2024, 6, 15, 12));
```

`aliasOf` is present only on non-canonical tzdb alias entries and names the
canonical zone:

```ts
const zones = getTimeZonesAt(Date.UTC(2024, 6, 15, 12));

zones.find((zone) => zone.name === "Asia/Calcutta")?.aliasOf; // "Asia/Kolkata"
zones.find((zone) => zone.name === "Asia/Kolkata")?.aliasOf; // undefined
```

The runtime implementation uses static offsets for single-offset zones and one
formatter per multi-offset abbreviation group to minimize formatter work.

## Implementation Validation

The test suite includes a parity check that iterates every UTC day from
`2026-01-01` through `2030-12-31` and verifies runtime output against a
test-only conservative validator.

Run it with:

```sh
bun run test
```

## Performance Notes

For implementation output parity coverage, see [Implementation Validation](#implementation-validation).

The utility uses a generated current-ish offset-to-abbreviation lookup in
`src/timezone-abbreviations.ts`. The generator uses pinned IANA tzdb source
data in `scripts/tzdb/data` and compiles it with `zic` before extracting
abbreviations (for example `NZST`/`NZDT`, `AEST`/`AEDT`).

At runtime the utility uses the generated table for the time zone list and
abbreviations. It still asks `Intl` for the UTC offset at the requested
timestamp, then picks the matching abbreviation from the static table.

This avoids formatting localized short names for every zone on every call while
still letting the timestamp decide whether the zone is on standard time or
daylight time. If the runtime's current tzdata no longer matches the generated
table, the utility falls back to the first generated abbreviation for that zone.

Refresh tzdb data and regenerate:

```sh
bun run generate
```

The generator also refreshes `src/timezone-aliases.ts` from pinned tzdb link
data so canonical names and their non-canonical aliases stay in sync.

## Scripts

```sh
bun install --ignore-scripts
bun run generate
bun run build
bun run test
```

`bun run build` bundles `src/index.ts` into `dist/index.js` (unminified ESM)
and `src/global.ts` into `dist/index.iife.js` (unminified IIFE that exposes
`globalThis.timezones`), then emits type declarations with `tsc`.

### Benchmark snapshot

Current benchmark output (Bun `v1.4.0`, Linux, [AMD Ryzen 7 PRO 5850U](https://www.cpubenchmark.net/cpu.php?id=4198), `438` zones, `50` iterations):

```md
| CPU cold full list                    | `9.031 ms` |
| CPU warm within-hour cache hit        | `0.013 ms` |
| CPU warm forced cache miss            | `0.666 ms` |
| Formatter cache size                  | `30`       |
| RSS memory delta after cache creation | `2.88 MiB` |
```

*Intl prewarm bootstrap adds a one-time per-process RSS overhead (about `1.50 MiB` on this machine), measured separately and excluded from the cache-creation delta above.*

Reproduce locally:

```sh
bun run benchcpu
bun run benchmem
```

Both benchmark scripts print markdown table rows with padded heading and value columns (`| <heading> | <value> |`) for terminal readability and easy copy/paste into docs.

Numbers vary by CPU, libc/ICU, runtime version, and active system load.
