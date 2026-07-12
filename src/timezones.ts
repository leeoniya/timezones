import {
  TIME_ZONE_ABBREVIATIONS,
  type TimeZoneAbbreviationEntry,
} from "./timezone-abbreviations.js";
import { TIME_ZONE_ALIAS_GROUPS } from "./timezone-aliases.js";

export interface TimeZoneInfo {
  /** IANA time zone identifier, for example "America/New_York". */
  name: string;
  /** Common static abbreviation, for example "EST", "EDT", or "NZDT". */
  abbr: string;
  /** UTC offset formatted as "+HH:MM" or "-HH:MM". */
  offset: string;
}

const DEFAULT_LOCALE = "en-US";

const offsetFormatterCache = new Map<string, Intl.DateTimeFormat>();
const GENERATED_TIME_ZONE_LOOKUP = TIME_ZONE_ABBREVIATIONS as Record<string, TimeZoneAbbreviationEntry>;
const TIME_ZONE_LOOKUP = createTimeZoneLookup();
const TIME_ZONE_ALIAS_SET = createAliasSet();
const AVAILABLE_TIME_ZONES = Object.keys(TIME_ZONE_LOOKUP);
const MS_PER_HOUR = 60 * 60 * 1000;
let representatives: ReadonlyMap<string, string> | undefined;
let cacheHour: number | undefined;
let cacheTimeZones: TimeZoneInfo[] | undefined;

/**
 * Returns all IANA time zones in the generated abbreviation lookup.
 */
export function getAvailableTimeZones(): string[] {
  return AVAILABLE_TIME_ZONES;
}

/**
 * Returns true when a time zone is a non-canonical alias.
 */
export function isAlias(timeZone: string): boolean {
  return TIME_ZONE_ALIAS_SET.has(timeZone);
}

/**
 * Builds a snapshot of each time zone's short name and UTC offset at a
 * specific instant.
 */
export function getTimeZonesAt(
  timestamp: number,
): TimeZoneInfo[] {
  const hourBucket = Math.floor(timestamp / MS_PER_HOUR);

  if (cacheHour === hourBucket && cacheTimeZones) {
    return cacheTimeZones;
  }

  const date = new Date(timestamp);
  representatives ??= createRepresentativeMap();
  const timeZones = listGroupedTimeZones(date, representatives, offsetFormatterCache);

  cacheHour = hourBucket;
  cacheTimeZones = timeZones;

  return timeZones;
}

function listGroupedTimeZones(
  date: Date,
  representatives: ReadonlyMap<string, string>,
  formatterCache: Map<string, Intl.DateTimeFormat>,
): TimeZoneInfo[] {
  return getAvailableTimeZones().map((timeZone) => {
    const entry = TIME_ZONE_LOOKUP[timeZone]!;

    const offset =
      getSingleStaticOffset(entry) ??
      getOffset(date, getRepresentative(representatives, timeZone), formatterCache);

    return createTimeZoneInfo(timeZone, offset);
  });
}

function createTimeZoneInfo(
  timeZone: string,
  offset: string,
): TimeZoneInfo {
  const entry = TIME_ZONE_LOOKUP[timeZone]!;

  return {
    name: timeZone,
    abbr: parseStoredAbbreviation(getStoredAbbreviation(entry, offset)),
    offset,
  };
}

function createTimeZoneLookup(): Record<string, TimeZoneAbbreviationEntry> {
  const unsortedLookup: Record<string, TimeZoneAbbreviationEntry> = {};

  for (const timeZone in GENERATED_TIME_ZONE_LOOKUP) {
    unsortedLookup[timeZone] = GENERATED_TIME_ZONE_LOOKUP[timeZone];
  }

  addAliasEntries(unsortedLookup);

  const sortedLookup: Record<string, TimeZoneAbbreviationEntry> = {};

  for (const timeZone of Object.keys(unsortedLookup).sort((timeZoneA, timeZoneB) => {
    return timeZoneA.localeCompare(timeZoneB);
  })) {
    sortedLookup[timeZone] = unsortedLookup[timeZone];
  }

  return sortedLookup;
}

function addAliasEntries(lookup: Record<string, TimeZoneAbbreviationEntry>): void {
  for (const [canonicalTimeZone, ...aliases] of TIME_ZONE_ALIAS_GROUPS) {
    const source = lookup[canonicalTimeZone]
      ? canonicalTimeZone
      : aliases.find((timeZone) => lookup[timeZone]);

    if (!source) {
      continue;
    }

    for (const alias of aliases) {
      if (!lookup[alias]) {
        lookup[alias] = lookup[source];
      }
    }

    if (!lookup[canonicalTimeZone]) {
      lookup[canonicalTimeZone] = lookup[source];
    }
  }
}

function createAliasSet(): ReadonlySet<string> {
  const aliases = new Set<string>();

  for (const [, ...groupAliases] of TIME_ZONE_ALIAS_GROUPS) {
    for (const alias of groupAliases) {
      aliases.add(alias);
    }
  }

  return aliases;
}

function createRepresentativeMap(
): ReadonlyMap<string, string> {
  const groups = new Map<string, string[]>();
  const representatives = new Map<string, string>();

  for (const [timeZone, entry] of Object.entries(TIME_ZONE_LOOKUP)) {
    if (Object.keys(entry).length <= 1) {
      continue;
    }

    const key = JSON.stringify(entry);
    const group = groups.get(key);

    if (group) {
      group.push(timeZone);
    } else {
      groups.set(key, [timeZone]);
    }
  }

  for (const zones of groups.values()) {
    const [representative, ...aliases] = zones;

    if (representative) {
      for (const alias of aliases) {
        representatives.set(alias, representative);
      }
    }
  }

  return representatives;
}

function getRepresentative(representatives: ReadonlyMap<string, string>, timeZone: string): string {
  return representatives.get(timeZone) ?? timeZone;
}

function getSingleStaticOffset(entry: TimeZoneAbbreviationEntry): string | undefined {
  const offsets = Object.keys(entry);

  if (offsets.length !== 1) {
    return undefined;
  }

  const firstOffset = offsets[0]!;

  return entry[firstOffset]!.endsWith("/0") ? firstOffset : undefined;
}

function getOffset(
  date: Date,
  timeZone: string,
  formatterCache: Map<string, Intl.DateTimeFormat>,
): string {
  const formatter = getOffsetFormatter(timeZone, formatterCache);
  const formatted = formatter.format(date);

  return parseShortOffset(formatted);
}

function getOffsetFormatter(
  timeZone: string,
  formatterCache: Map<string, Intl.DateTimeFormat>,
): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);

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

  formatterCache.set(timeZone, formatter);

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
