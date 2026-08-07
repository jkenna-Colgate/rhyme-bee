/**
 * The Editor's Pass: read a Daily Puzzle the night before it goes live, and add
 * the words that read turns up as missing.
 *
 *   npm run editor:read                          # tomorrow
 *   npm run editor:read -- --date=2026-08-20     # a named day
 *   npm run editor:read -- --seed=placeholder    # audition an unscheduled Seed
 *   npm run editor:add -- --words=placeholder,toothache
 *   npm run editor:add -- --words=earache --rhymeKey="EY K"
 *
 * On Windows PowerShell the bare `--` separator (and the token after it) is
 * stripped before npm forwards anything, so use the equals form above, or
 * invoke tsx directly: `npx tsx scripts/editor.ts read --date 2026-08-20`.
 *
 * Without this there is no way to see tomorrow's Puzzle at all: the date comes
 * from the player's own local calendar (ADR-0013) and there is no override
 * anywhere in the app. The readout is shaped for scanning against a third-party
 * rhyme list in another window — alphabetical, in columns — because that is the
 * comparison that finds the missing word, and it is done by eye.
 *
 * Resolving the scheduled Seed Word against the built Rhyme Index in order to
 * print it *is* the schedule/index agreement check, which nothing else performs
 * (#126). In production that disagreement is silent — `pinSeed` throws, the boot
 * policy catches it, and the player is handed Free Play instead of the Daily
 * Puzzle. Here it is a non-zero exit with the day, the Seed and the key named.
 *
 * The script never writes `data/schedule.json`. An audition prints a line to
 * paste; the schedule stays the hand-edited reviewed artifact ADR-0012 requires.
 *
 * `add` takes words and nothing else — no phonemes, ever. It composes a reading
 * from a compound split, hands what it cannot resolve to an agent, and holds
 * both to the same verification before either reaches `data/supplement.dict`
 * (ADR-0014). What still fails is appended to the deferred queue rather than
 * discarded, which is what makes the miss rate countable.
 *
 * An imperative shell carrying no game logic of its own, and left untested
 * exactly as `play`, `build-index` and `histogram` are — every figure it prints
 * comes from the tested core (`measureAnswers`, `checkDayDrift`, `buildPuzzle`,
 * `composeReading`, `verifyReading`), and its argument parsing lives in
 * `editorArgs.ts`, which is tested. The agent invocation is untested by the
 * same precedent — but the reading of what comes back is not game logic's
 * neighbour so much as a gate on it, so it lives in `editorReading.ts` and is
 * tested there.
 */

import { spawn } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCmudict } from "../src/cmudict.ts";
import { measureAnswers } from "../src/curation.ts";
import { loadRhymeIndex } from "../src/loader.ts";
import type { Pronunciation, RhymeKey } from "../src/phonology.ts";
import { parseWordList } from "../src/pipeline.ts";
import { applySupplement } from "../src/supplement.ts";
import {
  evidenceContextFrom,
  gatherEvidence,
  verifyReading,
  type EvidenceContext,
} from "../src/supplementEvidence.ts";
import type { PuzzleEntry, RhymeIndex, SeedWord } from "../src/rhymeIndex.ts";
import {
  checkDayDrift,
  localCalendarDate,
  parseSchedule,
  scheduleBands,
  type DayDrift,
  type PuzzleFacts,
  type Schedule,
  type ScheduleDay,
  type SizeBand,
} from "../src/schedule.ts";
import { indexArtifactPath } from "./indexArtifact.ts";
import { parseEditorArgs, tomorrow, type EditorArgs } from "./editorArgs.ts";
import { parseReading } from "./editorReading.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let args: EditorArgs;
try {
  args = parseEditorArgs(process.argv.slice(2));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const schedule = loadSchedule();

/**
 * The built index, loaded on first use. `add` never needs it — it reads the
 * pinned sources directly, as the supplement tooling does — and the artifact is
 * megabytes.
 */
let loaded: RhymeIndex | undefined;
function builtIndex(): RhymeIndex {
  loaded ??= loadRhymeIndex(indexArtifactPath(resolve(root, "dist-data")));
  return loaded;
}

// --- the two readouts ----------------------------------------------------------

/** One scheduled day, checked against the bands it was dealt from. */
function readDay(date: string): void {
  const day = schedule.days.find((d) => d.date === date);
  if (day === undefined) {
    const first = schedule.days[0]!.date;
    const last = schedule.days[schedule.days.length - 1]!.date;
    fail(`No Daily Puzzle scheduled for ${date}. The run covers ${first} to ${last}.`);
  }

  const puzzle = buildOrFail(day);
  const facts = measureAnswers(puzzle.answers);
  const drift = checkDayDrift(day, facts, scheduleBands(schedule));

  console.log("");
  console.log(`  ${day.date}  ${day.weekday}  ·  week ${day.week}`);
  printPuzzle(puzzle.seedRespelling, day.seed, day.rhymeKey);
  printFigures(facts, drift.sizeBand, drift);
  printDrift(drift);
  printWords(puzzle.answers, puzzle.bonusWords);
}

/**
 * A Seed Word that is not on the schedule, so a replacement can be read before
 * it is committed to. The pasteable entry is the point: it saves the editor
 * hand-typing a Rhyme Key in ARPAbet and forgetting the counts beside it.
 */
function audition(seed: string): void {
  let pinned: SeedWord;
  try {
    pinned = builtIndex().pinSeed(seed);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const puzzle = builtIndex().buildPuzzle(pinned);
  const facts = measureAnswers(puzzle.answers);

  console.log("");
  console.log(`  audition  ·  not on the schedule`);
  printPuzzle(puzzle.seedRespelling, pinned.word, pinned.rhymeKey);
  printFigures(facts, schedule.band, null);
  console.log("");
  console.log(`  Paste over the four fields of the day you are replacing:`);
  console.log(`    "seed": ${JSON.stringify(pinned.word)},`);
  console.log(`    "rhymeKey": ${JSON.stringify(pinned.rhymeKey)},`);
  console.log(`    "answerCount": ${facts.answerCount},`);
  console.log(`    "difficulty": ${Number(facts.difficulty.toFixed(4))}`);
  printWords(puzzle.answers, puzzle.bonusWords);
}

// --- printing (no game logic; every figure comes from the tested core) ---------

function printPuzzle(respelling: string, seed: string, rhymeKey: string): void {
  console.log("");
  console.log(`  Seed Word:  ${seed}  —  spoken "${respelling}"`);
  console.log(`  Rhyme Key:  ${rhymeKey}`);
}

/**
 * The three figures the day was dealt on. A long session and a hard one are
 * different things, so the Answer count and the Difficulty are shown against
 * their own bands rather than run together.
 */
function printFigures(facts: PuzzleFacts, size: SizeBand | undefined, drift: DayDrift | null): void {
  const band = drift?.weekdayBand;
  console.log("");
  console.log(
    `  Answers ${facts.answerCount}${size ? ` (band ${size.min}–${size.max})` : ""}` +
      `  ·  max Score ${facts.maxScore}`,
  );
  console.log(
    `  Difficulty ${facts.difficulty.toFixed(4)}` +
      (band ? `  (${band.weekday} band ${band.min.toFixed(4)}–${band.max.toFixed(4)})` : ""),
  );
  if (drift !== null) {
    console.log(
      `  recorded:  ${drift.recorded.answerCount} Answers  ·  ` +
        `Difficulty ${drift.recorded.difficulty.toFixed(4)}`,
    );
  }
}

const DRIFT_MESSAGE: Record<DayDrift["reasons"][number], string> = {
  "answer-count-out-of-band": "Answer count is outside the size band this day was dealt from",
  "difficulty-out-of-band": "Difficulty is outside its weekday's band",
};

function printDrift(drift: DayDrift): void {
  if (!drift.drifted) return;
  console.log("");
  for (const reason of drift.reasons) console.log(`  DRIFTED: ${DRIFT_MESSAGE[reason]}.`);
  console.log(`  Band membership is advisory after review (ADR-0012) — this is for your eye.`);
}

function printWords(answers: PuzzleEntry[], bonusWords: PuzzleEntry[]): void {
  console.log("");
  console.log(`  Answers (${answers.length})`);
  printColumns(answers);
  if (bonusWords.length > 0) {
    console.log("");
    console.log(`  Bonus Words (${bonusWords.length})`);
    printColumns(bonusWords);
  }
  console.log("");
}

/** Terminal width, when the terminal will say. Eighty is the safe floor. */
const TERMINAL_WIDTH = process.stdout.columns ?? 80;
const INDENT = "    ";
const GUTTER = 2;

/**
 * Alphabetical, and across the row rather than down the column, so the eye can
 * run a scheduled Puzzle's Answers against an alphabetical third-party list and
 * see the gap. One word per line puts a hundred-Answer Puzzle off the screen.
 */
function printColumns(entries: PuzzleEntry[]): void {
  const words = entries.map((e) => e.word).sort((a, b) => a.localeCompare(b));
  if (words.length === 0) {
    console.log(`${INDENT}(none)`);
    return;
  }
  const width = Math.max(...words.map((w) => w.length)) + GUTTER;
  const perRow = Math.max(1, Math.floor((TERMINAL_WIDTH - INDENT.length) / width));
  for (let i = 0; i < words.length; i += perRow) {
    const row = words.slice(i, i + perRow).map((w) => w.padEnd(width));
    console.log(INDENT + row.join("").trimEnd());
  }
}

// --- loading -------------------------------------------------------------------

function loadSchedule(): Schedule {
  const path = resolve(root, "data/schedule.json");
  const parsed = parseSchedule(JSON.parse(readFileSync(path, "utf8")));
  if (parsed === null) fail(`${path} is not a readable schedule artifact.`);
  return parsed;
}

/**
 * The agreement check. A scheduled Seed the built index cannot pin to the key
 * the schedule records is the failure that reaches players as a silent Free
 * Play, so it is the one thing here that must be impossible to skim past.
 */
function buildOrFail(day: ScheduleDay): ReturnType<RhymeIndex["buildPuzzle"]> {
  try {
    return builtIndex().buildPuzzle(builtIndex().pinSeed(day.seed, day.rhymeKey));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(
      `SCHEDULE / INDEX DISAGREEMENT on ${day.date} (${day.weekday}).\n` +
        `  Seed Word "${day.seed}" cannot be pinned to ${day.rhymeKey} in the built index.\n` +
        `  ${detail}\n` +
        `  A player asking for this date would be handed Free Play instead, silently.\n` +
        `  Fix the schedule entry or rebuild the index (npm run build:index).`,
    );
  }
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// --- adding a word by name -----------------------------------------------------

/**
 * The editor names words the pass turned up as missing, and nothing else — no
 * phonemes, and no per-entry comment, because the reason for an add is constant
 * (the word was absent from the pinned sources) and restating it every time
 * carries no information.
 *
 * Per word, in order: a name is refused outright; a word that already reads is
 * a correction and is left alone; otherwise a reading is composed from a
 * compound split, and if no split reaches the target the word goes to an agent
 * to author. Every proposal, whoever made it, passes the same `verifyReading`
 * before it is written (ADR-0014). Anything that still fails is appended to the
 * deferred queue, so a miss is recorded rather than rediscovered next time.
 */
async function add(words: string[], target: RhymeKey, provenance: string): Promise<void> {
  const ctx = evidenceContext();
  const accepted: { word: string; phonemes: Pronunciation }[] = [];
  const deferred: DeferredReading[] = [];

  console.log("");
  console.log(`  Adding ${words.length} word(s) against ${target}  ·  ${provenance}`);
  console.log("");

  for (const supplied of words) {
    const evidence = gatherEvidence(supplied, target, ctx);
    const word = evidence.word;
    console.log(`  ${word}`);

    // A name stays a name, however well it rhymes: the space of names is
    // unbounded and has no defensible edge. Refused rather than deferred —
    // deferring says "later", and this is never.
    if (evidence.isName) {
      console.log(`    refused: a Proper Noun stays a Proper Noun, however well it rhymes.`);
      continue;
    }

    if (evidence.direct.length > 0) {
      const verdict = evidence.rhymesDirectly
        ? `already reads on ${target} — it is in the game already, nothing to add.`
        : `already has a reading that does not rhyme. That is a CORRECTION, not an add:` +
          ` overriding an upstream pronunciation stays a deliberate hand-edit in` +
          ` data/supplement.dict.`;
      console.log(`    ${verdict}`);
      for (const reading of evidence.direct) console.log(`      ${reading.phonemes.join(" ")}`);
      continue;
    }

    if (evidence.composed !== null) {
      const { head, tail, phonemes } = evidence.composed;
      console.log(`    composed  ${phonemes.join(" ")}`);
      console.log(
        `    from      ${head.word} (${head.phonemes.join(" ")}) + ` +
          `${tail.word} (${tail.phonemes.join(" ")}), the tail taking secondary stress`,
      );
      accepted.push({ word, phonemes });
      continue;
    }

    console.log(`    no compound split reaches ${target} — asking the agent to author one.`);
    const authored = await authorWithAgent(word, target);
    if (authored === null) {
      deferred.push({ word, rhymeKey: target, reason: "agent-unavailable" });
      console.log(`    the agent did not answer. Deferred.`);
    } else if (verifyReading(authored, target)) {
      // The same predicate, applied to a reading this program did not compose.
      // Delegating authorship does not lower the bar.
      console.log(`    the agent proposed  ${authored.join(" ")}  — verified against ${target}.`);
      accepted.push({ word, phonemes: authored });
    } else {
      deferred.push({ word, rhymeKey: target, reason: "agent-reading-failed-verification" });
      console.log(`    the agent proposed  ${authored.join(" ")}, which does not reach ${target}. Deferred.`);
    }
  }

  appendToSupplement(accepted);
  appendToDeferredQueue(deferred);
  printAddSummary(accepted, deferred);
}

/** One word the pass could not resolve, kept so the miss rate is countable. */
interface DeferredReading {
  word: string;
  rhymeKey: RhymeKey;
  reason: "agent-unavailable" | "agent-reading-failed-verification";
}

/**
 * The pinned inputs with the committed supplement merged over them and
 * Normalisation applied on top — the same stack, in the same order, that the
 * index build reads (`src/manufacture.ts`). The target Rhyme Key an add is
 * aimed at always comes from the built artifact or the schedule, so a context
 * assembled any other way judges the evidence under a different phonology from
 * the one that set the target, and loses words to a disagreement about the
 * accent rather than about the rhyme.
 *
 * So a word added earlier tonight is already present, and can serve as a part
 * of tonight's next compound.
 */
function evidenceContext(): EvidenceContext {
  const read = (name: string) => readFileSync(resolve(root, "data", name), "utf8");
  const pronunciations = parseCmudict(read("cmudict.dict"));
  const words = parseWordList(read("words.txt"));
  const names = parseWordList(read("names.txt"));
  applySupplement(read(SUPPLEMENT), { pronunciations, words, names });
  return evidenceContextFrom({ pronunciations, words, names });
}

/**
 * Ask the agent to author a reading for a word no split resolves, following the
 * pattern the dev feedback button established: the `claude` CLI in headless
 * print mode on the maintainer's Pro subscription, no API key and no new
 * dependency.
 *
 * Never throws. A missing CLI, a non-zero exit and unparseable output are all
 * the same outcome to the caller — the word is deferred and the night carries
 * on. A tooling problem costs a few words, not the evening.
 */
function authorWithAgent(word: string, target: RhymeKey): Promise<Pronunciation | null> {
  const prompt = [
    `Write the General American CMUdict/ARPAbet pronunciation of the English word "${word}".`,
    `It must rhyme on the Rhyme Key ${target} — that is, the phonemes from its last`,
    `stressed vowel to the end of the word must be exactly: ${target}.`,
    "",
    "Use ARPAbet phonemes with stress digits on vowels (0 unstressed, 1 primary,",
    "2 secondary), separated by single spaces. A compound's final element usually",
    "takes secondary rather than primary stress.",
    "",
    "Respond with ONLY the phonemes on one line. No word, no quotes, no explanation.",
  ].join("\n");

  return new Promise((done) => {
    const child = spawn("claude", ["-p", "--model", "sonnet"], { shell: true });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", () => {});
    child.on("error", () => done(null));
    child.on("close", (code) => done(code === 0 ? parseReading(stdout) : null));
    child.stdin.end(prompt);
  });
}

const SUPPLEMENT = "supplement.dict";
const DEFERRED_QUEUE = "deferred-readings.jsonl";

/**
 * The section the pass appends to, written once. There is no per-entry comment
 * — the reason for an add is constant, and a line restating it every time
 * carries no information (ADR-0014).
 */
const EDITOR_SECTION =
  "# --- Adds by the Editor's Pass: composed from a compound split and verified\n" +
  "# against the day's Rhyme Key before being written here (ADR-0014). ---";

function appendToSupplement(readings: { word: string; phonemes: Pronunciation }[]): void {
  if (readings.length === 0) return;
  const path = resolve(root, "data", SUPPLEMENT);
  const existing = readFileSync(path, "utf8");
  const section = existing.includes(EDITOR_SECTION) ? "" : `\n${EDITOR_SECTION}\n`;
  const lines = readings.map((r) => `${r.word} ${r.phonemes.join(" ")}`).join("\n");
  appendFileSync(path, `${section}${lines}\n`);
}

/**
 * The deferred queue, in the shape `supplement-candidates.jsonl` established.
 * It is the work list for a later human or agent pass — each entry carries the
 * word and the Rhyme Key it must reach, which is all an author needs — and it
 * is what makes the composition's real miss rate countable. Discarding misses
 * would forfeit that, and a second composition rule is meant to be decided from
 * this file's contents rather than from the next frustrating word.
 */
function appendToDeferredQueue(deferred: DeferredReading[]): void {
  if (deferred.length === 0) return;
  const timestamp = new Date().toISOString();
  const lines = deferred.map((d) => JSON.stringify({ ...d, timestamp })).join("\n");
  appendFileSync(resolve(root, "data", DEFERRED_QUEUE), `${lines}\n`);
}

function printAddSummary(
  accepted: { word: string }[],
  deferred: DeferredReading[],
): void {
  console.log("");
  if (accepted.length > 0) {
    console.log(`  ${accepted.length} reading(s) appended to data/${SUPPLEMENT}.`);
    console.log(`  Commit it, then npm run deploy — the fix applies to every Puzzle`);
    console.log(`  the word appears in, and a Session already in progress picks it up.`);
  }
  if (deferred.length > 0) {
    console.log(`  ${deferred.length} word(s) appended to data/${DEFERRED_QUEUE} for a later pass.`);
  }
  if (accepted.length === 0 && deferred.length === 0) {
    console.log(`  Nothing to write.`);
  }
  console.log("");
}

/** The Rhyme Key an add is aimed at: an explicit one, or the day's. */
function targetFor(date: string): { target: RhymeKey; provenance: string } {
  const day = schedule.days.find((d) => d.date === date);
  if (day === undefined) {
    fail(`No Daily Puzzle scheduled for ${date}. Pass --rhymeKey to add against a key directly.`);
  }
  return { target: day.rhymeKey, provenance: `${day.date}, the ${day.seed} Puzzle` };
}

// --- run -----------------------------------------------------------------------

if (args.command === "add") {
  const { target, provenance } =
    args.rhymeKey !== undefined
      ? { target: args.rhymeKey, provenance: "an explicit Rhyme Key" }
      : targetFor(args.date ?? tomorrow(localCalendarDate()));
  await add(args.words!, target, provenance);
} else if (args.seed !== undefined) {
  audition(args.seed);
} else {
  readDay(args.date ?? tomorrow(localCalendarDate()));
}
