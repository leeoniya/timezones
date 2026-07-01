# Timezones

Dependency-free TypeScript utility for listing available IANA time zones with
their short names and UTC offsets at a specific instant.

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
`src/timezone-abbreviations.ts`. The generator prefers system tzdata
abbreviations, such as `NZST`/`NZDT` and `AEST`/`AEDT`, and falls back to
`Intl` only while generating if the system lookup is unavailable. At runtime the
utility uses the generated table for the time zone list and abbreviations. It
still asks `Intl` for the UTC offset at the requested timestamp, then picks the
matching abbreviation from the static table.

This avoids formatting localized short names for every zone on every call while
still letting the timestamp decide whether the zone is on standard time or
daylight time. If the runtime's current tzdata no longer matches the generated
table, the utility falls back to the first generated abbreviation for that zone.

Regenerate the table after runtime or tzdata updates:

```sh
npm run generate
```

## Scripts

```sh
npm install --ignore-scripts
npm run build
npm test
```
