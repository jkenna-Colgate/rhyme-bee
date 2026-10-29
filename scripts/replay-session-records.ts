/**
 * Replay the pulled Session Records against the current Rhyme Index (ADR-0019).
 *
 *   npm run records:replay
 *   npm run records:replay -- 2026-10-29
 *
 * For each record (or each on one date): its Rank, its Score of the maximum,
 * and every rejection with its reason. Pull them first with
 * `npm run records:pull`. A record whose index hash is not this build's says
 * what today's index makes of the Session rather than exactly what the player
 * saw, and one with no hash (a past date when it was sent) is marked the same.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRhymeIndex } from "../src/loader.ts";
import { replaySessionRecord } from "../src/sessionRecordReplay.ts";
import { indexArtifactPath, readIndexManifest } from "./indexArtifact.ts";
import { readPulledRecords, SESSION_RECORDS_DIR } from "./sessionRecordStore.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distData = resolve(root, "dist-data");
const onlyDate = process.argv[2];

if (onlyDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(onlyDate)) {
  console.error(`Usage: npm run records:replay [-- YYYY-MM-DD]  (got ${JSON.stringify(onlyDate)})`);
  process.exit(1);
}

const pulled = readPulledRecords(resolve(root, SESSION_RECORDS_DIR));
for (const path of pulled.unreadable) console.warn(`  ! ${path} holds no readable Session Record.`);

const records = pulled.records.filter((r) => onlyDate === undefined || r.date === onlyDate);
if (records.length === 0) {
  console.log("No pulled Session Records to replay. Run `npm run records:pull` first.");
  process.exit(0);
}

const index = loadRhymeIndex(indexArtifactPath(distData));
const builtHash = readIndexManifest(distData)?.hash;

for (const record of records) {
  const replay = replaySessionRecord(index, record);
  const head = `${record.date}  ${record.seed.word} (${record.seed.rhymeKey})  ${record.id.slice(0, 8)}`;
  if (!replay.replayed) {
    console.log(`${head}\n  cannot replay: ${replay.problem}\n`);
    continue;
  }
  const judged =
    record.indexHash === undefined
      ? "no index hash"
      : record.indexHash === builtHash
        ? "same index"
        : `index ${record.indexHash}`;
  console.log(
    `${head}  [${judged}]\n` +
      `  ${replay.rank.label}, ${replay.score}/${replay.maxScore}, ` +
      `${replay.found.answers.length}/${replay.totalAnswers} Answers, ` +
      `${replay.found.bonus.length} other accepted, ${replay.outcome}`,
  );
  for (const rejection of replay.rejections) {
    console.log(`  ✗ ${rejection.word}: ${rejection.reason} (${rejection.message})`);
  }
  console.log("");
}
