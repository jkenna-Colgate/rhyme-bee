/**
 * The Editor's Pass: read a Daily Puzzle the night before it goes live.
 *
 *   npm run editor:read                          # tomorrow
 *   npm run editor:read -- --date=2026-08-20     # a named day
 *   npm run editor:read -- --seed=placeholder    # audition an unscheduled Seed
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
 * An imperative shell carrying no game logic of its own, and left untested
 * exactly as `play`, `build-index` and `histogram` are — every figure it prints
 * comes from the tested core (`measureAnswers`, `checkDayDrift`, `buildPuzzle`),
 * and its argument parsing lives in `editorArgs.ts`, which is tested.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { measureAnswers } from "../src/curation.ts";
import { loadRhymeIndex } from "../src/loader.ts";
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

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let args: EditorArgs;
try {
  args = parseEditorArgs(process.argv.slice(2));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const index = loadRhymeIndex(indexArtifactPath(resolve(root, "dist-data")));
const schedule = loadSchedule();

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
    pinned = index.pinSeed(seed);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const puzzle = index.buildPuzzle(pinned);
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
    return index.buildPuzzle(index.pinSeed(day.seed, day.rhymeKey));
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

// --- run -----------------------------------------------------------------------

if (args.seed !== undefined) {
  audition(args.seed);
} else {
  readDay(args.date ?? tomorrow(localCalendarDate()));
}
