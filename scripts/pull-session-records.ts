/**
 * Pull the Session Records down from the bucket (ADR-0019, #230).
 *
 *   npm run records:pull
 *
 * Each object under `sessions/` is one Daily Puzzle Session, written by the
 * deployed Worker and overwritten as that Session grows. This brings them home
 * to `data/session-records/<date>/<id>.json`, which is gitignored: Session
 * Records are never committed. Read them with `npm run records:replay`.
 *
 * Run it as often as you like. A record already held is fetched again only while
 * its date may still be in play somewhere, so a repeat run costs one listing and
 * a handful of reads. It reads the bucket with the same scoped read-only R2 API
 * token as `npm run appeals:pull` (see `appealPull.ts`), and it only ever
 * reads: nothing is deleted from the bucket.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseSessionRecord,
  sessionRecordKey,
  SESSION_RECORD_KEY_PREFIX,
} from "../src/sessionRecord.ts";
import { parseEnvFile, readCredentials } from "./appealPull.ts";
import { getObject, listObjects } from "./r2Bucket.ts";
import {
  keysToFetch,
  pulledKeys,
  SESSION_RECORDS_DIR,
  writePulledRecord,
} from "./sessionRecordStore.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const recordsDir = resolve(root, SESSION_RECORDS_DIR);
const credentialsPath = resolve(root, "credentials.env");

const settings: Record<string, string | undefined> = {
  ...parseEnvFile(existsSync(credentialsPath) ? readFileSync(credentialsPath, "utf8") : ""),
  ...process.env,
};

async function main(): Promise<void> {
  const credentials = readCredentials(settings);

  console.log(`Listing ${SESSION_RECORD_KEY_PREFIX} in ${credentials.bucket}…`);
  const keys = await listObjects(credentials, SESSION_RECORD_KEY_PREFIX);
  if (keys.length === 0) {
    console.log("No Session Records in the bucket. Nothing to pull.");
    return;
  }

  // UTC today: with `keysToFetch`'s day-before margin, that covers every date a
  // player anywhere could still be playing.
  const today = new Date().toISOString().slice(0, 10);
  const fresh = keysToFetch(keys, pulledKeys(recordsDir), today);
  console.log(`${keys.length} Session Record(s) in the bucket; fetching ${fresh.length}.`);

  let written = 0;
  for (const key of fresh) {
    const body = await getObject(credentials, key);
    const record = parseSessionRecord(body);
    if (record === null) {
      console.warn(`  ! ${key} holds no readable Session Record. Left in the bucket, not written.`);
      continue;
    }
    if (sessionRecordKey(record) !== key) {
      console.warn(
        `  ! ${key} is not the key its own record derives. The Worker and this pull\n` +
          "    may have drifted apart; the record was kept under the listed key. Check #230.",
      );
    }
    writePulledRecord(recordsDir, key, body);
    written += 1;
  }

  console.log(`\nWrote ${written} Session Record(s) to ${recordsDir}.`);
  console.log("Next: npm run records:replay");
}

try {
  await main();
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
