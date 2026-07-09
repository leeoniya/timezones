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
import { listTimeZonesAt } from "./src";

const zones = listTimeZonesAt(Date.UTC(2024, 6, 15, 12));

console.log(zones.find((zone) => zone.name === "America/New_York"));
// {
//   name: "America/New_York",
//   abbr: "EDT",
//   offset: "-04:00"
// }
```

## API

### `listTimeZonesAt(timestamp, strategy?)`

Returns one entry per time zone:

```ts
interface TimeZoneInfo {
  name: string;
  abbr: string;
  offset: string;
}
```

`timestamp` is a numeric UTC millisecond timestamp.

`strategy` can be `"conservative"`, `"balanced"`, or `"fastest"`. It defaults
to `"conservative"`.

```ts
listTimeZonesAt(Date.UTC(2024, 6, 15, 12), "fastest");
```

`"conservative"` uses one `Intl.DateTimeFormat` per time zone.
This is the most accurate option.

`"balanced"` uses one formatter per generated
offset-to-abbreviation group. This reduces formatter count while accepting
current-ish approximation around transition edge cases.

`"fastest"` uses static offsets for zones with one generated
offset and one formatter per multi-offset group. This is the fastest and most
approximate option.

## Performance Notes

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
npm run generate
```

The generator also refreshes `scripts/timezone-aliases.ts` from pinned tzdb link
data so canonical names missing from `Intl.supportedValuesOf("timeZone")` are
kept in sync with supported aliases.

## Scripts

```sh
npm install --ignore-scripts
npm run generate
npm run build
npm test
```
