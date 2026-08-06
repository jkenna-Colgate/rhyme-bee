/**
 * Pull the day's Appealed words down into the candidate queue.
 *
 *   npm run appeals:pull
 *
 * The first step of the play-test refine loop: pull, judge into the pronunciation
 * supplement, rebuild the index, deploy. A player tapped "should count" on a
 * rejection they were sure about, the deployed endpoint wrote that report to R2
 * as one object (#119), and this brings the batch home.
 *
 * It appends to the queue the judging flow already reads,
 * `data/supplement-candidates.jsonl`, in the format that flow already produces —
 * each object body *is* a JSON Lines record, so the append is a concatenation and
 * nothing is transcribed or reassembled. `npm run supplement:candidates` is
 * unchanged and cannot tell a pulled record from one the dev button jotted.
 *
 * Run it as often as you like. A record's object key is derived from the record,
 * so the queue and its archive already say which objects have been pulled; a
 * second run lists the bucket, recognises everything in it, and appends nothing.
 * That also means it never fetches an object twice — the listing alone settles
 * it, so a repeat run costs one request.
 *
 * This is a maintainer script. It runs here, never in the browser, and is no part
 * of the deployed bundle. It reads the bucket with the scoped read-only R2 API
 * token from #114 Step 8 (see `appealPull.ts` for why the account login will not
 * do), and it only ever reads: judged records are archived locally, and nothing
 * is deleted from the bucket.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CANDIDATE_KEY_PREFIX } from "../src/supplementCandidate.ts";
import {
  candidateKeysIn,
  parseEnvFile,
  readCredentials,
  selectNewCandidates,
  type AppealObject,
} from "./appealPull.ts";
import { getObject, listObjects } from "./r2Bucket.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(root, "data");
const queuePath = resolve(dataDir, "supplement-candidates.jsonl");
const archivePath = resolve(dataDir, "supplement-candidates.archived.jsonl");
const credentialsPath = resolve(root, "credentials.env");

function readIfPresent(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/**
 * Environment first, then the git-ignored `credentials.env`. Exporting a variable
 * for one run should not mean editing a file, and the file should not silently
 * override what was exported deliberately.
 */
const settings: Record<string, string | undefined> = {
  ...parseEnvFile(readIfPresent(credentialsPath)),
  ...process.env,
};

async function main(): Promise<void> {
  const credentials = readCredentials(settings);

  console.log(`Listing ${CANDIDATE_KEY_PREFIX} in ${credentials.bucket}…`);
  const keys = await listObjects(credentials, CANDIDATE_KEY_PREFIX);

  if (keys.length === 0) {
    console.log("No Appealed words in the bucket. Nothing to pull.");
    return;
  }

  // The queue and its archive between them hold every record ever pulled, and a
  // key is derived from its record — so this is enough to skip fetching an
  // object we already have, rather than fetching it and discarding it after.
  const held = candidateKeysIn(readIfPresent(queuePath), readIfPresent(archivePath));
  const fresh = keys.filter((key) => !held.has(key));

  console.log(
    `${keys.length} Appealed word(s) in the bucket; ${fresh.length} not yet in the queue.`,
  );
  if (fresh.length === 0) {
    console.log("Everything in the bucket has been pulled already. Queue unchanged.");
    return;
  }

  const objects: AppealObject[] = [];
  for (const key of fresh) {
    objects.push({ key, body: await getObject(credentials, key) });
  }

  const selection = selectNewCandidates(objects, held);

  for (const key of selection.unreadable) {
    console.warn(`  ! ${key} holds no readable candidate — left in the bucket, not queued.`);
  }
  for (const key of selection.misfiled) {
    console.warn(
      `  ! ${key} is not the key its own record derives — the writing end and this\n` +
        "    one may have drifted apart. The record was queued anyway; check #119.",
    );
  }

  if (selection.added.length === 0) {
    console.log("Nothing new to append. Queue unchanged.");
    return;
  }

  mkdirSync(dataDir, { recursive: true });
  appendFileSync(queuePath, selection.append, "utf8");

  console.log(`\nAppended ${selection.added.length} candidate(s) to ${queuePath}:`);
  for (const candidate of selection.added) {
    console.log(`  ${candidate.word}   (against seed "${candidate.seedWord}", ${candidate.reason})`);
  }
  console.log("\nNext: `npm run supplement:candidates` to judge the queue.");
}

try {
  await main();
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
