import { execFileSync } from "node:child_process";

import { TIME_ZONE_ALIAS_GROUPS } from "./timezone-aliases.ts";

export type TimeZoneAbbreviationEntry = Record<string, string>;
export type TimeZoneAbbreviations = Record<string, TimeZoneAbbreviationEntry>;

const LOCALE = "en-US";
const SHORT_OFFSET_PATTERN = /\b(?:GMT|UTC)(?<sign>[+-])(?<hours>\d{1,2})(?::(?<minutes>\d{2}))?\b/;

export function getSampleDates(year: number): Date[] {
  return [
    new Date(Date.UTC(year, 0, 15, 12)),
    new Date(Date.UTC(year, 6, 15, 12)),
  ];
}

export function shouldIncludeTimeZone(timeZone: string): boolean {
  return !/^Etc\/GMT[+-]\d+$/.test(timeZone);
}

export function addAliasEntries(entries: TimeZoneAbbreviations): void {
  for (const aliases of TIME_ZONE_ALIAS_GROUPS) {
    const source = aliases.find((timeZone) => entries[timeZone]);

    if (!source) {
      continue;
    }

    for (const alias of aliases) {
      if (!entries[alias] && isAcceptedTimeZone(alias)) {
        entries[alias] = entries[source];
      }
    }
  }
}

export function createEntry(timeZone: string, sampleDates: Date[]): TimeZoneAbbreviationEntry {
  const variants = sampleDates.map((date) => ({
    abbreviation: getCommonTimeZoneAbbreviation(date, timeZone),
    offset: getOffset(date, timeZone),
  }));

  return Object.fromEntries(
    variants.map((variant) => [variant.offset, variant.abbreviation]),
  );
}

export function serializeEntries(
  entries: TimeZoneAbbreviations,
  serializeValue: (entry: TimeZoneAbbreviationEntry) => string,
): string {
  return Object.entries(entries)
    .toSorted(([timeZoneA], [timeZoneB]) => timeZoneA.localeCompare(timeZoneB))
    .map(([timeZone, value]) => `  ${JSON.stringify(timeZone)}: ${serializeValue(value)},`)
    .join("\n");
}

export function serializeEntry(entry: TimeZoneAbbreviationEntry): string {
  const properties = Object.entries(entry)
    .map(([offset, abbreviation]) => `${JSON.stringify(offset)}: ${JSON.stringify(abbreviation)}`)
    .join(", ");

  return `{${properties}}`;
}

function isAcceptedTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat(LOCALE, { timeZone });

    return true;
  } catch {
    return false;
  }
}

function getCommonTimeZoneAbbreviation(date: Date, timeZone: string): string {
  return getSystemTimeZoneAbbreviation(date, timeZone) ?? getShortTimeZoneName(date, timeZone);
}

function getSystemTimeZoneAbbreviation(date: Date, timeZone: string): string | undefined {
  try {
    return execFileSync("date", ["-d", `@${Math.floor(date.getTime() / 1000)}`, "+%Z"], {
      encoding: "utf8",
      env: {
        ...process.env,
        TZ: timeZone,
      },
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function getShortTimeZoneName(date: Date, timeZone: string): string {
  return getTimeZoneNamePart(
    new Intl.DateTimeFormat(LOCALE, {
      timeZone,
      timeZoneName: "short",
    }),
    date,
  );
}

function getOffset(date: Date, timeZone: string): string {
  return parseShortOffset(getShortOffsetName(date, timeZone));
}

function getShortOffsetName(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    timeZoneName: "shortOffset",
  }).format(date);
}

function getTimeZoneNamePart(formatter: Intl.DateTimeFormat, date: Date): string {
  return formatter.formatToParts(date).find((part) => part.type === "timeZoneName")?.value ?? "";
}

function parseShortOffset(formatted: string): string {
  const match = SHORT_OFFSET_PATTERN.exec(formatted);

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
