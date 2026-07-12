import {
  getAvailableTimeZones,
  type TimeZoneInfo,
} from "../../dist/timezones.js";
import {
  TIME_ZONE_ABBREVIATIONS,
  type TimeZoneAbbreviationEntry,
} from "../../dist/timezone-abbreviations.js";
import { TIME_ZONE_ALIAS_GROUPS } from "../../dist/timezone-aliases.js";

const DEFAULT_LOCALE = "en-US";
const conservativeOffsetFormatterCache = new Map<string, Intl.DateTimeFormat>();
const ALIAS_TO_CANONICAL = createAliasToCanonicalMap();

export function getConservativeTimeZonesAt(timestamp: number): TimeZoneInfo[] {
  const date = new Date(timestamp);

  return getAvailableTimeZones().map((timeZone) => {
    const entry = getEntryForZone(timeZone);

    if (!entry) {
      throw new Error(`No abbreviation entry found for "${timeZone}".`);
    }

    const offset = getOffset(date, timeZone);

    return {
      name: timeZone,
      abbr: parseStoredAbbreviation(getStoredAbbreviation(entry, offset)),
      offset,
    };
  });
}

function createAliasToCanonicalMap(): ReadonlyMap<string, string> {
  const aliasToCanonical = new Map<string, string>();

  for (const [canonical, ...aliases] of TIME_ZONE_ALIAS_GROUPS) {
    for (const alias of aliases) {
      aliasToCanonical.set(alias, canonical);
    }
  }

  return aliasToCanonical;
}

function getEntryForZone(timeZone: string): TimeZoneAbbreviationEntry | undefined {
  const direct = TIME_ZONE_ABBREVIATIONS[timeZone];

  if (direct) {
    return direct;
  }

  const canonical = ALIAS_TO_CANONICAL.get(timeZone);
  return canonical ? TIME_ZONE_ABBREVIATIONS[canonical] : undefined;
}

function getOffset(date: Date, timeZone: string): string {
  const formatter = getOffsetFormatter(timeZone);
  const formatted = formatter.format(date);

  return parseShortOffset(formatted);
}

function getOffsetFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = conservativeOffsetFormatterCache.get(timeZone);

  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    timeZone,
    timeZoneName: "shortOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  conservativeOffsetFormatterCache.set(timeZone, formatter);

  return formatter;
}

function parseShortOffset(formatted: string): string {
  const match = /\b(?:GMT|UTC)(?<sign>[+-])(?<hours>\d{1,2})(?::(?<minutes>\d{2}))?\b/.exec(
    formatted,
  );

  if (!match?.groups) {
    if (/\b(?:GMT|UTC)\b/.test(formatted)) {
      return "+00:00";
    }

    throw new Error(`Unable to parse UTC offset from "${formatted}".`);
  }

  if (match.groups.hours === "0" && !match.groups.minutes) {
    return "+00:00";
  }

  const sign = match.groups.sign;
  const hours = Number(match.groups.hours);
  const minutes = Number(match.groups.minutes ?? "0");

  return `${sign}${pad2(hours)}:${pad2(minutes)}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function getStoredAbbreviation(entry: TimeZoneAbbreviationEntry, offset: string): string {
  const exact = entry[offset];

  if (exact) {
    return exact;
  }

  for (const key of Object.keys(entry)) {
    const fallback = entry[key];

    if (fallback) {
      return fallback;
    }
  }

  return "";
}

function parseStoredAbbreviation(value: string): string {
  const separatorIndex = value.lastIndexOf("/");
  return value.slice(0, separatorIndex);
}
