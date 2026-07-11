import {
  TIME_ZONE_ABBREVIATIONS,
  type TimeZoneAbbreviationEntry,
} from "./timezone-abbreviations.js";

export interface TimeZoneInfo {
  /** IANA time zone identifier, for example "America/New_York". */
  name: string;
  /** Common static abbreviation, for example "EST", "EDT", or "NZDT". */
  abbr: string;
  /** UTC offset formatted as "+HH:MM" or "-HH:MM". */
  offset: string;
}

export type TimeZoneStrategy = "conservative" | "balanced" | "fastest";

const DEFAULT_LOCALE = "en-US";

const conservativeOffsetFormatterCache = new Map<string, Intl.DateTimeFormat>();
const balancedOffsetFormatterCache = new Map<string, Intl.DateTimeFormat>();
const fastestOffsetFormatterCache = new Map<string, Intl.DateTimeFormat>();
const GENERATED_TIME_ZONE_LOOKUP = TIME_ZONE_ABBREVIATIONS as Record<string, TimeZoneAbbreviationEntry>;
const TIME_ZONE_LOOKUP = createSupportedTimeZoneLookup();
const MS_PER_HOUR = 60 * 60 * 1000;
let balancedRepresentatives: ReadonlyMap<string, string> | undefined;
let fastestRepresentatives: ReadonlyMap<string, string> | undefined;
let cacheHour: number | undefined;
let cacheStrategy: TimeZoneStrategy | undefined;
let cacheTimeZones: TimeZoneInfo[] | undefined;

/**
 * Returns all IANA time zones in the generated abbreviation lookup.
 */
export function getAvailableTimeZones(): string[] {
  return Object.keys(TIME_ZONE_LOOKUP);
}

/**
 * Builds a snapshot of each time zone's short name and UTC offset at a
 * specific instant.
 */
export function getTimeZonesAt(
  timestamp: number,
  strategy: TimeZoneStrategy = "conservative",
): TimeZoneInfo[] {
  const hourBucket = Math.floor(timestamp / MS_PER_HOUR);

  if (cacheHour === hourBucket && cacheStrategy === strategy && cacheTimeZones) {
    return cacheTimeZones;
  }

  const date = new Date(timestamp);
  let timeZones: TimeZoneInfo[];

  if (strategy === "balanced") {
    balancedRepresentatives ??= createRepresentativeMap(() => true);

    timeZones = listGroupedTimeZones(date, balancedRepresentatives, balancedOffsetFormatterCache, false);
  } else if (strategy === "fastest") {
    fastestRepresentatives ??= createRepresentativeMap((entry) => Object.keys(entry).length > 1);

    timeZones = listGroupedTimeZones(date, fastestRepresentatives, fastestOffsetFormatterCache, true);
  } else {
    timeZones = getAvailableTimeZones().map((timeZone) => {
      return createTimeZoneInfo(
        timeZone,
        getOffset(date, timeZone, conservativeOffsetFormatterCache),
      );
    });
  }

  cacheHour = hourBucket;
  cacheStrategy = strategy;
  cacheTimeZones = timeZones;

  return timeZones;
}

function listGroupedTimeZones(
  date: Date,
  representatives: ReadonlyMap<string, string>,
  formatterCache: Map<string, Intl.DateTimeFormat>,
  useStaticSingleOffset: boolean,
): TimeZoneInfo[] {
  return getAvailableTimeZones().map((timeZone) => {
    const entry = TIME_ZONE_LOOKUP[timeZone];

    if (!entry) {
      throw new Error(`No abbreviation entry found for time zone "${timeZone}".`);
    }

    const offset =
      (useStaticSingleOffset ? getSingleStaticOffset(entry) : undefined) ??
      getOffset(date, getRepresentative(representatives, timeZone), formatterCache);

    return createTimeZoneInfo(timeZone, offset);
  });
}

function createTimeZoneInfo(
  timeZone: string,
  offset: string,
): TimeZoneInfo {
  const entry = TIME_ZONE_LOOKUP[timeZone];

  if (!entry) {
    throw new Error(`No abbreviation entry found for time zone "${timeZone}".`);
  }

  return {
    name: timeZone,
    abbr: entry[offset] ?? Object.values(entry)[0] ?? "",
    offset,
  };
}

function createSupportedTimeZoneLookup(): Record<string, TimeZoneAbbreviationEntry> {
  const supportedTimeZones = new Set(Intl.supportedValuesOf("timeZone"));
  const lookup: Record<string, TimeZoneAbbreviationEntry> = {};

  for (const timeZone in GENERATED_TIME_ZONE_LOOKUP) {
    if (supportedTimeZones.has(timeZone) || timeZone === "UTC") {
      lookup[timeZone] = GENERATED_TIME_ZONE_LOOKUP[timeZone];
    }
  }

  return lookup;
}

function createRepresentativeMap(
  shouldGroup: (entry: TimeZoneAbbreviationEntry) => boolean,
): ReadonlyMap<string, string> {
  const groups = new Map<string, string[]>();
  const representatives = new Map<string, string>();

  for (const [timeZone, entry] of Object.entries(TIME_ZONE_LOOKUP)) {
    if (!shouldGroup(entry)) {
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

  return offsets.length === 1 ? offsets[0] : undefined;
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
