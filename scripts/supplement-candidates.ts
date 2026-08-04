/**
 * Gather the evidence a supplement judge needs, either for each queued
 * candidate or for a maintainer-supplied word list.
 *
 *   npm run supplement:candidates                 # print the queue's evidence
 *   npm run supplement:candidates -- --archive       # ...then clear the queue
 *
 *   npm run supplement:candidates -- --words ule,rule,fluke --target="UW L"
 *                                                  # print evidence for a
 *                                                  # supplied word list against
 *                                                  # one target Rhyme Key
 *
 * Queue mode reads the append-only capture queue
 * (`data/supplement-candidates.jsonl`, jotted by the dev-only "should count"
 * button). Word-list mode instead judges words a maintainer names directly —
 * a family sweep ("these 38 words all end in -ule, against target UW L") that
 * never went through play and so has no captured Seed of its own.
 *
 * Both modes print, against the same pinned inputs the index build uses: each
 * word's wordhood / name status, any direct CMUdict reading (the *correction*
 * case), and its inflectional relatives that CMUdict actually holds with their
 * Rhyme Keys (the *derivation* case — `overjoy` has no reading, but
 * `overjoyed` does). Either way it decides nothing: the add / correct /
 * derive / defer call is the judge's, per `docs/agents/supplement-judge.md`.
 * `--archive` moves the judged queue aside, and only applies to queue mode.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCmudict, normaliseWord } from "../src/cmudict.ts";
import { Derivation, IndexDataSource } from "../src/derivation.ts";
import { parseWordList } from "../src/pipeline.ts";
import { parseCandidates } from "../src/supplementCandidate.ts";
import { gatherEvidence, type EvidenceContext, type ReadingEvidence, type WordEvidence } from "../src/supplementEvidence.ts";
import { parseCandidatesArgs } from "./candidatesArgs.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(root, "data");
const queuePath = resolve(dataDir, "supplement-candidates.jsonl");
const archivePath = resolve(dataDir, "supplement-candidates.archived.jsonl");

function read(name: string): string {
  return readFileSync(resolve(dataDir, name), "utf8");
}

/** A reading rendered `phonemes  (key: …)`, or a note if absent. */
function renderReading(reading: ReadingEvidence): string {
  return `${reading.phonemes.join(" ")}   (key: ${reading.key ?? "—"})`;
}

/**
 * The evidence body shared by both modes: wordhood/name status, then either
 * the correction case (a direct reading exists) or the derivation case
 * (inflectional relatives, if any). Each mode prints its own header line(s)
 * — the queue's captured Seed, or the word-list's shared target — before this.
 */
function printEvidenceBody(evidence: WordEvidence): void {
  console.log(`  wordhood (words.txt): ${evidence.isWord ? "yes" : "no"}   name (names.txt): ${evidence.isName ? "YES — do not launder" : "no"}`);

  if (evidence.direct.length > 0) {
    console.log(`  in CMUdict already → likely a CORRECTION (stress fix):`);
    for (const r of evidence.direct) console.log(`      ${renderReading(r)}`);
    console.log(`      current reading ${evidence.rhymesDirectly ? "ALREADY rhymes" : "does NOT rhyme"} with target ${evidence.target}`);
  } else {
    console.log(`  absent from CMUdict → an ADD (hand-author, or derive from an inflection below):`);
    if (evidence.relatives.length === 0) {
      console.log(`      no inflectional relative found in CMUdict — hand-author the reading, or DEFER.`);
    } else {
      for (const rel of evidence.relatives) {
        console.log(`      ${rel.word}:`);
        for (const r of rel.readings) console.log(`          ${renderReading(r)}`);
        console.log(`          (${rel.rhymes ? "a reading of this relative rhymes on the target" : "strip the inflection, then check the stem's key against " + evidence.target})`);
      }
    }
  }
}

/** The banner both modes open with, naming what's being judged. */
function printIntro(subject: string): void {
  console.log(`# Supplement candidates: ${subject}\n`);
  console.log("Decide each per docs/agents/supplement-judge.md. Defer any you are");
  console.log("genuinely unsure about — do not guess a stress you cannot defend.\n");
}

/** One evidence entry: separator, mode-specific header line(s), body, blank. */
function printEntry(headerLines: string[], evidence: WordEvidence): void {
  console.log("────────────────────────────────────────────────────────");
  for (const line of headerLines) console.log(line);
  printEvidenceBody(evidence);
  console.log("");
}

/** The closing instructions both modes end with, naming what "its seed" means here. */
function printFooter(seedNote: string): void {
  console.log("────────────────────────────────────────────────────────");
  console.log("Append the judged entries to data/supplement.dict, then");
  console.log(`\`npm run build:index\` and confirm each adjudicates against ${seedNote}.\n`);
}

function runQueueMode(archive: boolean, ctx: EvidenceContext): void {
  if (!existsSync(queuePath)) {
    console.log("No candidate queue yet (data/supplement-candidates.jsonl). Nothing to judge.");
    return;
  }

  const candidates = parseCandidates(readFileSync(queuePath, "utf8"));
  if (candidates.length === 0) {
    console.log("Candidate queue is empty. Nothing to judge.");
    return;
  }

  printIntro(`${candidates.length} to judge`);

  for (const c of candidates) {
    const evidence = gatherEvidence(c.word, c.seedRhymeKey, ctx);
    printEntry(
      [
        `${evidence.word}   — played against seed "${c.seedWord}" (target Rhyme Key: ${evidence.target})`,
        `  engine rejected as: ${c.reason}${c.engineRespelling ? ` (read “${c.engineRespelling}”)` : ""}`,
      ],
      evidence,
    );
  }

  printFooter("its seed");

  if (archive) {
    appendFileSync(archivePath, readFileSync(queuePath, "utf8"), "utf8");
    writeFileSync(queuePath, "", "utf8");
    console.log(`Archived ${candidates.length} judged candidate(s) to ${archivePath} and cleared the queue.`);
  }
}

function runWordListMode(words: string[], target: string, ctx: EvidenceContext): void {
  printIntro(`${words.length} supplied word(s) against target Rhyme Key ${target}`);

  for (const word of words) {
    const evidence = gatherEvidence(word, target, ctx);
    printEntry([`${evidence.word}   — target Rhyme Key: ${evidence.target}`], evidence);
  }

  printFooter("its intended seed");
}

const args = parseCandidatesArgs(process.argv.slice(2));

const pronunciations = parseCmudict(read("cmudict.dict"));
const words = parseWordList(read("words.txt"));
const names = parseWordList(read("names.txt"));

// The judge's related-forms evidence is answered under the engine's own rule,
// against these very inputs — so a base the engine would refuse to reduce to is
// never offered to a human as though it were one (#105).
const derivation = new Derivation(new IndexDataSource({ words, pronunciations }));
const ctx: EvidenceContext = { pronunciations, words, names, derivation };

if (args.wordList) {
  runWordListMode(args.wordList.words.map(normaliseWord), args.wordList.target, ctx);
} else {
  runQueueMode(args.archive, ctx);
}
