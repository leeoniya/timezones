# Generation Overview

This document summarizes how `scripts/generate-abbreviations.ts` builds:

- `src/timezone-abbreviations.ts`
- `src/timezone-aliases.ts`

## 1) Canonical Abbreviation List

Output: `src/timezone-abbreviations.ts`

1. Load pinned tzdb and create a resolver via `createIanaTzdbResolver()`.
2. Read canonical zone names from:
   - `scripts/tzdb/data/zone.tab`
   - `scripts/tzdb/data/zone1970.tab`
3. Filter canonical names with:
   - `shouldIncludeTimeZone(name)` (excludes `Etc/GMT[+-]N` style entries)
   - `isAcceptedTimeZone(name)` (must be accepted by `Intl.DateTimeFormat`)
4. Sort canonical names alphabetically.
5. Ensure `"UTC"` is present.
6. Build abbreviation entries with `createEntry(...)` using sampled dates
   (Jan/Jul in current UTC year).
7. Serialize/write `TIME_ZONE_ABBREVIATIONS`.

## 2) Alias Group List

Output: `src/timezone-aliases.ts`

1. Build a runtime-supported alias allowlist as the union of:
   - Node `Intl.supportedValuesOf("timeZone")`
   - Bun `Intl.supportedValuesOf("timeZone")`
2. Parse tzdb `Link` lines and build connected components of linked names.
3. For each component:
   - Select canonical names from tzdb canonical sets (`zone.tab`/`zone1970.tab`)
     that pass `isAcceptedTimeZone`.
   - Pick the first canonical name (sorted) as the group head.
   - Select aliases that are:
     - non-canonical
     - present in Node-or-Bun support union
     - IANA-style (`name.includes("/")`)
     - in the same top-level area as canonical (same `Area/...` prefix)
4. Emit group only when alias list is non-empty:
   - `[canonical, ...aliases]`
5. Sort groups by canonical name.
6. Validate each group:
   - first item is canonical
   - aliases are non-canonical
   - aliases are present in Node/Bun support union
7. Serialize/write `TIME_ZONE_ALIAS_GROUPS`.

## 3) Output Guarantees

- `src/timezone-abbreviations.ts` contains canonical names (plus `UTC`) only.
- `src/timezone-aliases.ts` contains canonical-first groups.
- Runtime uses alias groups to:
  - inject aliases into the final available list
  - back `isAlias()` via a precomputed set.
