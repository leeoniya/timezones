import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { TIME_ZONE_ALIAS_GROUPS } from "./timezone-aliases.ts";

export type TimeZoneAbbreviationEntry = Record<string, string>;
export type TimeZoneAbbreviations = Record<string, TimeZoneAbbreviationEntry>;
export interface TimeZoneSampleVariant {
  abbreviation: string;
  offset: string;
}
export interface IanaTzdbResolver {
  version: string;
  resolveVariant: (date: Date, timeZone: string) => TimeZoneSampleVariant;
  dispose: () => void;
}

const LOCALE = "en-US";
export const IANA_TZDB_SOURCE_FILES = [
  "africa",
  "antarctica",
  "asia",
  "australasia",
  "europe",
  "northamerica",
  "southamerica",
  "etcetera",
  "factory",
  "backward",
  "backzone",
] as const;

export function getSampleDates(year: number): Date[] {
  return [
    new Date(Date.UTC(year, 0, 15, 12)),
    new Date(Date.UTC(year, 6, 15, 12)),
  ];
}

export function shouldIncludeTimeZone(timeZone: string): boolean {
  return !/^Etc\/GMT[+-]\d+$/.test(timeZone);
}

export function addAliasEntries(
  entries: TimeZoneAbbreviations,
  aliasGroups: readonly (readonly string[])[] = TIME_ZONE_ALIAS_GROUPS,
): void {
  for (const aliases of aliasGroups) {
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

export function createEntry(
  timeZone: string,
  sampleDates: Date[],
  resolveVariant: (date: Date, timeZone: string) => TimeZoneSampleVariant,
): TimeZoneAbbreviationEntry {
  const variants = sampleDates.map((date) => resolveVariant(date, timeZone));

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

export function createIanaTzdbResolver(): IanaTzdbResolver {
  const { version, sourcePaths } = getPinnedTzdbSourceData();
  const workingDir = mkdtempSync(join(tmpdir(), "timezones-tzdb-"));
  const zoneInfoDir = join(workingDir, "zoneinfo");

  mkdirSync(zoneInfoDir, { recursive: true });

  try {
    execFileSync("zic", ["-d", zoneInfoDir, ...sourcePaths], {
      encoding: "utf8",
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (error) {
    rmSync(workingDir, { recursive: true, force: true });

    throw new Error(
      "Unable to compile pinned IANA tzdb data. Ensure `zic` is installed and run `npm run generate` (or `npm run update-tzdb`).",
      { cause: error },
    );
  }

  return {
    version,
    resolveVariant: (date, timeZone) => getIanaVariant(date, timeZone, zoneInfoDir),
    dispose: () => {
      rmSync(workingDir, { recursive: true, force: true });
    },
  };
}

function getIanaVariant(date: Date, timeZone: string, zoneInfoDir: string): TimeZoneSampleVariant {
  let output: string;

  try {
    output = execFileSync("date", ["-d", `@${Math.floor(date.getTime() / 1000)}`, "+%:z %Z"], {
      encoding: "utf8",
      env: {
        ...process.env,
        TZDIR: zoneInfoDir,
        TZ: timeZone,
      },
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (error) {
    throw new Error(`Unable to read abbreviation for "${timeZone}" from pinned IANA tzdb.`, {
      cause: error,
    });
  }

  const [offset, abbreviation] = output.split(/\s+/, 2);

  if (!offset || !abbreviation) {
    throw new Error(`Unable to parse IANA tzdb output "${output}" for "${timeZone}".`);
  }

  return { abbreviation, offset };
}

function getPinnedTzdbSourceData(): { version: string; sourcePaths: string[] } {
  const versionFilePath = fileURLToPath(new URL("./tzdb/version.txt", import.meta.url));

  if (!existsSync(versionFilePath)) {
    throw new Error("Pinned IANA tzdb is missing. Run `npm run generate` (or `npm run update-tzdb`).");
  }

  const version = readFileSync(versionFilePath, "utf8").trim();

  if (!version) {
    throw new Error(
      "Pinned IANA tzdb version file is empty. Run `npm run generate` (or `npm run update-tzdb`).",
    );
  }

  const sourcePaths = IANA_TZDB_SOURCE_FILES.map((name) => {
    const sourcePath = fileURLToPath(new URL(`./tzdb/data/${name}`, import.meta.url));

    if (!existsSync(sourcePath)) {
      throw new Error(
        `Pinned IANA tzdb source file "${name}" is missing. Run \`npm run generate\` (or \`npm run update-tzdb\`).`,
      );
    }

    return sourcePath;
  });

  return { version, sourcePaths };
}
