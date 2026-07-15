import assert from "node:assert/strict";
import test from "node:test";

import {
  getAvailableTimeZones,
  getTimeZonesAt,
  type TimeZoneInfo,
} from "../src/timezones.ts";
import { TIME_ZONE_ABBREVIATIONS } from "../src/timezone-abbreviations.ts";
import { TIME_ZONE_ALIAS_GROUPS } from "../src/timezone-aliases.ts";
import { getConservativeTimeZonesAt } from "./utils/conservative-timezones.ts";

const JANUARY_2024 = Date.UTC(2024, 0, 15, 12);
const JULY_2024 = Date.UTC(2024, 6, 15, 12);

test("includes UTC in the available timezone list", () => {
  assert.equal(getAvailableTimeZones().includes("UTC"), true);
});

test("excludes fixed Etc/GMT offset aliases from the available timezone list", () => {
  assert.equal(getAvailableTimeZones().some((timeZone) => /^Etc\/GMT[+-]\d+$/.test(timeZone)), false);
});

test("only includes generated canonical zones and aliases", () => {
  const canonicalNames = new Set(Object.keys(TIME_ZONE_ABBREVIATIONS));
  const aliasNames = new Set<string>();
  const zonesByName = new Map(getTimeZonesAt(JANUARY_2024).map((zone) => [zone.name, zone]));

  for (const [canonicalName, ...aliases] of TIME_ZONE_ALIAS_GROUPS) {
    assert.equal(zonesByName.get(canonicalName)?.aliasOf, undefined, canonicalName);
    for (const alias of aliases) {
      aliasNames.add(alias);
      assert.equal(zonesByName.get(alias)?.aliasOf, canonicalName, alias);
    }
  }

  for (const timeZone of getAvailableTimeZones()) {
    assert.equal(canonicalNames.has(timeZone) || aliasNames.has(timeZone), true, timeZone);
  }
});

test("returns available time zones in sorted order", () => {
  const available = getAvailableTimeZones();
  const sorted = [...available].sort((timeZoneA, timeZoneB) => timeZoneA.localeCompare(timeZoneB));

  assert.deepEqual(available, sorted);
});

test("reports non-canonical aliases through the aliasOf field", () => {
  const zonesByName = new Map(getTimeZonesAt(JANUARY_2024).map((zone) => [zone.name, zone]));

  assert.equal(zonesByName.get("Asia/Saigon")?.aliasOf, "Asia/Ho_Chi_Minh");
  assert.equal(zonesByName.get("Asia/Ho_Chi_Minh")?.aliasOf, undefined);
  assert.equal(zonesByName.get("Asia/Calcutta")?.aliasOf, "Asia/Kolkata");
  assert.equal(zonesByName.get("Asia/Kolkata")?.aliasOf, undefined);
  assert.equal(zonesByName.get("UTC")?.aliasOf, undefined);
});

test("lists abbreviations and offsets for supplied time zones", () => {
  const zones = pickZones(getTimeZonesAt(JANUARY_2024), ["UTC", "America/New_York", "Asia/Calcutta"]);

  assert.deepEqual(
    Object.fromEntries(zones.map(({ name, abbr, offset }) => [name, { abbr, offset }])),
    {
      UTC: { abbr: "UTC", offset: "+00:00" },
      "America/New_York": { abbr: "EST", offset: "-05:00" },
      "Asia/Calcutta": { abbr: "IST", offset: "+05:30" },
    },
  );
});

test("runtime output matches conservative validation for every day through 2030", () => {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const START_OF_2026 = Date.UTC(2026, 0, 1);
  const START_OF_2031 = Date.UTC(2031, 0, 1);

  for (let timestamp = START_OF_2026; timestamp < START_OF_2031; timestamp += ONE_DAY_MS) {
    const conservative = JSON.stringify(getConservativeTimeZonesAt(timestamp));
    const runtime = JSON.stringify(getTimeZonesAt(timestamp));
    const iso = new Date(timestamp).toISOString();

    assert.equal(
      runtime === conservative,
      true,
      `runtime mismatch at ${iso}`,
    );
  }
});

test("captures daylight saving changes at the requested timestamp", () => {
  const [winter] = pickZones(getTimeZonesAt(JANUARY_2024), ["America/New_York"]);
  const [summer] = pickZones(getTimeZonesAt(JULY_2024), ["America/New_York"]);

  assert.equal(winter.abbr, "EST");
  assert.equal(winter.offset, "-05:00");
  assert.equal(summer.abbr, "EDT");
  assert.equal(summer.offset, "-04:00");
});

test("handles southern hemisphere daylight time", () => {
  const [summer] = pickZones(getTimeZonesAt(JANUARY_2024), ["Australia/Sydney"]);
  const [winter] = pickZones(getTimeZonesAt(JULY_2024), ["Australia/Sydney"]);

  assert.equal(summer.abbr, "AEDT");
  assert.equal(summer.offset, "+11:00");
  assert.equal(winter.abbr, "AEST");
  assert.equal(winter.offset, "+10:00");
});

test("uses common New Zealand abbreviations instead of GMT offsets", () => {
  const [summer] = pickZones(getTimeZonesAt(JANUARY_2024), ["Pacific/Auckland"]);
  const [winter] = pickZones(getTimeZonesAt(JULY_2024), ["Pacific/Auckland"]);

  assert.equal(summer.abbr, "NZDT");
  assert.equal(summer.offset, "+13:00");
  assert.equal(winter.abbr, "NZST");
  assert.equal(winter.offset, "+12:00");
});

test("reuses cached result for the same hour bucket", () => {
  const first = getTimeZonesAt(JANUARY_2024);
  const second = getTimeZonesAt(JANUARY_2024 + 30 * 60 * 1000);
  const third = getTimeZonesAt(JANUARY_2024 + 60 * 60 * 1000);

  assert.strictEqual(second, first);
  assert.notStrictEqual(third, first);
});

function pickZones(zones: TimeZoneInfo[], timeZones: string[]): TimeZoneInfo[] {
  const wanted = new Set(timeZones);

  return zones.filter(({ name }) => wanted.has(name));
}
