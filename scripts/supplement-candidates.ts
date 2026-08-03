/**
 * Gather the evidence a supplement judge needs for each queued candidate.
 *
 *   npm run supplement:candidates            # print the evidence report
 *   npm run supplement:candidates -- --archive   # ...then clear the queue
 *
 * Reads the append-only capture queue (`data/supplement-candidates.jsonl`, jotted
 * by the dev-only "should count" button) and, against the same pinned inputs the
 * index build uses, prints for each candidate: its wordhood / name status, any
 * direct CMUdict reading (the *correction* case), and its inflectional relatives
 * that CMUdict actually holds with their Rhyme Keys (the *derivation* case —
 * `overjoy` has no reading, but `overjoyed` does). It decides nothing: the
 * add / correct / derive / defer call is the judge's, per
 * `docs/agents/supplement-judge.md`. `--archive` moves the judged queue aside.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCmudict, normaliseWord } from "../src/cmudict.ts";
import { Derivation, IndexDataSource } from "../src/derivation.ts";
import { parseWordList } from "../src/pipeline.ts";
import { rhymeKeyOf } from "../src/phonology.ts";
import { inflectionalVariants } from "../src/inflections.ts";
import { parseCandidates } from "../src/supplementCandidate.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(root, "data");
const queuePath = resolve(dataDir, "supplement-candidates.jsonl");
const archivePath = resolve(dataDir, "supplement-candidates.archived.jsonl");

function read(name: string): string {
  return readFileSync(resolve(dataDir, name), "utf8");
}

if (!existsSync(queuePath)) {
  console.log("No candidate queue yet (data/supplement-candidates.jsonl). Nothing to judge.");
  process.exit(0);
}

const candidates = parseCandidates(readFileSync(queuePath, "utf8"));
if (candidates.length === 0) {
  console.log("Candidate queue is empty. Nothing to judge.");
  process.exit(0);
}

const pronunciations = parseCmudict(read("cmudict.dict"));
const words = parseWordList(read("words.txt"));
const names = parseWordList(read("names.txt"));

// The judge's related-forms evidence is answered under the engine's own rule,
// against these very inputs — so a base the engine would refuse to reduce to is
// never offered to a human as though it were one (#105).
const derivation = new Derivation(new IndexDataSource({ words, pronunciations }));

/** The Rhyme Keys of every reading a surface form has in CMUdict. */
function keysOf(word: string): string[] {
  const prons = pronunciations.get(word) ?? [];
  const keys = new Set<string>();
  for (const pron of prons) {
    const key = rhymeKeyOf(pron);
    if (key !== null) keys.add(key);
  }
  return [...keys];
}

/** A CMUdict reading rendered `phonemes  (key: …)`, or a note if absent. */
function readings(word: string): string[] {
  const prons = pronunciations.get(word) ?? [];
  return prons.map((p) => `${p.join(" ")}   (key: ${rhymeKeyOf(p) ?? "—"})`);
}

console.log(`# Supplement candidates: ${candidates.length} to judge\n`);
console.log("Decide each per docs/agents/supplement-judge.md. Defer any you are");
console.log("genuinely unsure about — do not guess a stress you cannot defend.\n");

for (const c of candidates) {
  const word = normaliseWord(c.word);
  const target = c.seedRhymeKey;

  console.log("────────────────────────────────────────────────────────");
  console.log(`${word}   — played against seed "${c.seedWord}" (target Rhyme Key: ${target})`);
  console.log(`  engine rejected as: ${c.reason}${c.engineRespelling ? ` (read “${c.engineRespelling}”)` : ""}`);
  console.log(`  wordhood (words.txt): ${words.has(word) ? "yes" : "no"}   name (names.txt): ${names.has(word) ? "YES — do not launder" : "no"}`);

  const direct = readings(word);
  if (direct.length > 0) {
    const rhymes = keysOf(word).includes(target);
    console.log(`  in CMUdict already → likely a CORRECTION (stress fix):`);
    for (const r of direct) console.log(`      ${r}`);
    console.log(`      current reading ${rhymes ? "ALREADY rhymes" : "does NOT rhyme"} with target ${target}`);
  } else {
    console.log(`  absent from CMUdict → an ADD (hand-author, or derive from an inflection below):`);
    const relatives = inflectionalVariants(word, derivation).filter((v) => pronunciations.has(v));
    if (relatives.length === 0) {
      console.log(`      no inflectional relative found in CMUdict — hand-author the reading, or DEFER.`);
    } else {
      for (const rel of relatives) {
        const rhymes = keysOf(rel).some((k) => k === target);
        console.log(`      ${rel}:`);
        for (const r of readings(rel)) console.log(`          ${r}`);
        console.log(`          (${rhymes ? "a reading of this relative rhymes on the target" : "strip the inflection, then check the stem's key against " + target})`);
      }
    }
  }
  console.log("");
}

console.log("────────────────────────────────────────────────────────");
console.log("Append the judged entries to data/supplement.dict, then");
console.log("`npm run build:index` and confirm each adjudicates against its seed.\n");

const archive = process.argv.includes("--archive");
if (archive) {
  appendFileSync(archivePath, readFileSync(queuePath, "utf8"), "utf8");
  writeFileSync(queuePath, "", "utf8");
  console.log(`Archived ${candidates.length} judged candidate(s) to ${archivePath} and cleared the queue.`);
}
