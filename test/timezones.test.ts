import assert from "node:assert/strict";
import test from "node:test";

import {
  getAvailableTimeZones,
  getTimeZonesAt,
  isAlias,
  type TimeZoneInfo,
} from "../dist/timezones.js";
import { TIME_ZONE_ABBREVIATIONS } from "../dist/timezone-abbreviations.js";
import { TIME_ZONE_ALIAS_GROUPS } from "../dist/timezone-aliases.js";

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

  for (const [canonicalName, ...aliases] of TIME_ZONE_ALIAS_GROUPS) {
    assert.equal(isAlias(canonicalName), false, canonicalName);
    for (const alias of aliases) {
      aliasNames.add(alias);
      assert.equal(isAlias(alias), true, alias);
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

test("reports non-canonical alias membership", () => {
  assert.equal(isAlias("Asia/Saigon"), true);
  assert.equal(isAlias("Asia/Ho_Chi_Minh"), false);
  assert.equal(isAlias("Asia/Calcutta"), true);
  assert.equal(isAlias("Asia/Kolkata"), false);
  assert.equal(isAlias("UTC"), false);
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

test("default list uses the conservative strategy", () => {
  assert.deepEqual(
    pickZones(getTimeZonesAt(JULY_2024), ["America/New_York", "Pacific/Auckland"]),
    pickZones(getTimeZonesAt(JULY_2024, "conservative"), ["America/New_York", "Pacific/Auckland"]),
  );
});

test("balanced and fastest strategies return matching current-ish values", () => {
  const timeZones = ["UTC", "America/Anchorage", "America/Juneau", "Europe/Berlin", "Pacific/Auckland"];
  const timestamp = JULY_2024;

  assert.deepEqual(
    pickZones(getTimeZonesAt(timestamp, "balanced"), timeZones),
    pickZones(getTimeZonesAt(timestamp, "conservative"), timeZones),
  );
  assert.deepEqual(
    pickZones(getTimeZonesAt(timestamp, "fastest"), timeZones),
    pickZones(getTimeZonesAt(timestamp, "conservative"), timeZones),
  );
});

test("all strategies return identical results for monthly checkpoints in 2026", () => {
  for (let month = 0; month < 12; month += 1) {
    const timestamp = Date.UTC(2026, month, 1, 12);
    const conservative = JSON.stringify(getTimeZonesAt(timestamp, "conservative"));
    const balanced = JSON.stringify(getTimeZonesAt(timestamp, "balanced"));
    const fastest = JSON.stringify(getTimeZonesAt(timestamp, "fastest"));
    const iso = new Date(timestamp).toISOString();

    assert.equal(
      balanced === conservative,
      true,
      `balanced mismatch at ${iso}`,
    );
    assert.equal(
      fastest === conservative,
      true,
      `fastest mismatch at ${iso}`,
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

test("reuses cached result for the same hour bucket and strategy", () => {
  const first = getTimeZonesAt(JANUARY_2024, "conservative");
  const second = getTimeZonesAt(JANUARY_2024 + 30 * 60 * 1000, "conservative");
  const third = getTimeZonesAt(JANUARY_2024 + 30 * 60 * 1000, "balanced");

  assert.strictEqual(second, first);
  assert.notStrictEqual(third, first);
});

function pickZones(zones: TimeZoneInfo[], timeZones: string[]): TimeZoneInfo[] {
  const wanted = new Set(timeZones);

  return zones.filter(({ name }) => wanted.has(name));
}
