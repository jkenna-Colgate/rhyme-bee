/**
 * Download the four index sources, and the Wiktionary extract a Batch reads
 * (#268), from the private mirror into `data/`.
 *
 *   npm run sources:fetch
 *
 * What a fresh clone, or CI (#273), runs before `npm run build:index`. Each file
 * is checked against `data/sources.sha256`, the committed checksums, and if any
 * one fails the fetch refuses and writes nothing. A local copy that already
 * matches is kept, so a repeat run downloads nothing.
 *
 * It reads the bucket with the same scoped read-only R2 token as
 * `npm run appeals:pull`: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID` and
 * `R2_SECRET_ACCESS_KEY` from the environment (how CI passes them) or from the
 * git-ignored `credentials.env`. It never prompts, so it runs unattended.
 *
 * It prints file names and nothing else about the files: the prevalence norms
 * are licensed for academic use and a CI log is public.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnvFile, readCredentials } from "./appealPull.ts";
import { getObjectBytes } from "./r2Bucket.ts";
import { CHECKSUM_FILE, fetchSources, type SourceFault } from "./sourceMirror.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(root, "data");
const credentialsPath = resolve(root, "credentials.env");

const settings: Record<string, string | undefined> = {
  ...parseEnvFile(existsSync(credentialsPath) ? readFileSync(credentialsPath, "utf8") : ""),
  ...process.env,
};

const PROBLEM: Record<SourceFault["problem"], string> = {
  missing: "is missing",
  mismatch: "in the mirror does not match its committed checksum",
  unpinned: `has no line in data/${CHECKSUM_FILE}`,
};

async function main(): Promise<void> {
  const credentials = readCredentials(settings);
  console.log(`Fetching the index sources from ${credentials.bucket}…`);

  const result = await fetchSources(dataDir, async (key) => {
    try {
      return await getObjectBytes(credentials, key);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("NoSuchKey")) throw error;
      throw new Error(
        `${error.message}\nThe mirror has no ${key}. Nothing was written to data/. It is put ` +
          "there by `npm run sources:upload`, from the machine that holds the source.",
      );
    }
  });

  if (result.faults.length > 0) {
    throw new Error(
      "Refusing: nothing was written to data/.\n" +
        result.faults.map((fault) => `  ${fault.file} ${PROBLEM[fault.problem]}.`).join("\n") +
        "\n\nThe mirror and the committed checksums disagree. Whoever changed the source\n" +
        "should run `npm run sources:upload -- <file>` from the machine holding the\n" +
        "right bytes, and commit the checksum it rewrites.",
    );
  }

  for (const file of result.kept) console.log(`  ${file}: already matches, kept.`);
  for (const file of result.fetched) console.log(`  ${file}: fetched and verified.`);
}

try {
  await main();
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
