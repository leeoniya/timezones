import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { IANA_TZDB_SOURCE_FILES } from "./utils.ts";

const IANA_TZDATA_LATEST_URL = "https://data.iana.org/time-zones/tzdata-latest.tar.gz";

const DATA_DIR_PATH = fileURLToPath(new URL("./tzdb/data/", import.meta.url));
const VERSION_FILE_PATH = fileURLToPath(new URL("./tzdb/version.txt", import.meta.url));

const tarballMembers = ["version", "zone.tab", "zone1970.tab", ...IANA_TZDB_SOURCE_FILES];

await updatePinnedTzdb();

async function updatePinnedTzdb(): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), "timezones-tzdb-update-"));
  const tarballPath = join(tempDir, "tzdata-latest.tar.gz");

  try {
    await downloadTarball(IANA_TZDATA_LATEST_URL, tarballPath);

    await rm(DATA_DIR_PATH, { recursive: true, force: true });
    await mkdir(DATA_DIR_PATH, { recursive: true });
    extractTarball(tarballPath, DATA_DIR_PATH, tarballMembers);

    const version = (await readFile(join(DATA_DIR_PATH, "version"), "utf8")).trim();

    if (!version) {
      throw new Error("Downloaded tzdata archive is missing a version value.");
    }

    await writeFile(VERSION_FILE_PATH, `${version}\n`);
    console.log(`Updated pinned IANA tzdb to ${version}.`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function downloadTarball(url: string, outputPath: string): Promise<void> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "timezones-tzdb-updater/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download tzdata archive (${response.status} ${response.statusText}).`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, bytes);
}

function extractTarball(tarballPath: string, destinationDir: string, members: readonly string[]): void {
  try {
    execFileSync("tar", ["-xzf", tarballPath, "-C", destinationDir, ...members], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (error) {
    throw new Error("Unable to extract tzdata archive. Ensure `tar` is installed.", {
      cause: error,
    });
  }
}
