import assert from "node:assert/strict";
import test from "node:test";

import {
  getAvailableTimeZones,
  getTimeZonesAt,
  type TimeZoneInfo,
} from "../dist/timezones.js";

const JANUARY_2024 = Date.UTC(2024, 0, 15, 12);
const JULY_2024 = Date.UTC(2024, 6, 15, 12);

test("includes UTC in the available timezone list", () => {
  assert.equal(getAvailableTimeZones().includes("UTC"), true);
});

test("excludes fixed Etc/GMT offset aliases from the available timezone list", () => {
  assert.equal(getAvailableTimeZones().some((timeZone) => /^Etc\/GMT[+-]\d+$/.test(timeZone)), false);
});

test("only includes time zones supported by Intl plus UTC", () => {
  const supportedTimeZones = new Set(Intl.supportedValuesOf("timeZone"));

  for (const timeZone of getAvailableTimeZones()) {
    assert.equal(timeZone === "UTC" || supportedTimeZones.has(timeZone), true, timeZone);
  }
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
