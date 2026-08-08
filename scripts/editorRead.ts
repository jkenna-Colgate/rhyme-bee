/**
 * Half of the Editor's Pass: **reading** a Daily Puzzle the night before it
 * goes live — the terminal's rendering of it. Printing the day's Answers and
 * Bonus Words in a shape the eye can scan. Writes nothing, anywhere.
 *
 * Without this there is no way to see tomorrow's Puzzle at all: the date comes
 * from the player's own local calendar (ADR-0013) and there is no override
 * anywhere in the app. The readout is shaped for scanning against a third-party
 * rhyme list in another window — alphabetical, in columns — because that is the
 * comparison that finds the missing word, and it is done by eye.
 *
 * *What* a day is now lives in `editorDay.ts` and arrives here as a value; this
 * module decides only how it looks, and is one renderer of two (#150). The
 * failure cases arrive the same way, and this is where they become a non-zero
 * exit — the browser renders them instead. The schedule/index agreement check
 * that nothing else performs (#126) is a case in that value, not a throw caught
 * here.
 *
 * This module never writes `data/schedule.json`. An audition prints a line to
 * paste; the schedule stays the hand-edited reviewed artifact ADR-0012 requires.
 *
 * An imperative shell carrying no game logic of its own, and left untested
 * exactly as `play`, `build-index` and `histogram` are — every figure it prints
 * comes from the tested core (`readScheduledDay`, `measureAnswers`,
 * `checkDayDrift`, `buildPuzzle`).
 */

import { resolve } from "node:path";
import { measureAnswers } from "../src/curation.ts";
import { loadRhymeIndex } from "../src/loader.ts";
import type { RhymeIndex, SeedWord } from "../src/rhymeIndex.ts";
import type {
  DayDrift,
  PuzzleFacts,
  Schedule,
  SizeBand,
} from "../src/schedule.ts";
import { readScheduledDay, type UnpinnableDayReadout } from "./editorDay.ts";
import { indexArtifactPath } from "./indexArtifact.ts";
import { fail, message, root } from "./editorShell.ts";

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
export function readDay(schedule: Schedule, date: string): void {
  const readout = readScheduledDay(builtIndex(), schedule, date);

  if (readout.outcome === "not-scheduled") {
    fail(
      `No Daily Puzzle scheduled for ${date}. ` +
        `The run covers ${readout.firstDate} to ${readout.lastDate}.`,
    );
  }
  if (readout.outcome === "unpinnable") failDisagreement(readout);

  console.log("");
  console.log(`  ${readout.date}  ${readout.weekday}  ·  week ${readout.week}`);
  printPuzzle(readout.seedRespelling, readout.seed, readout.rhymeKey);
  printFigures(readout.facts, readout.drift.sizeBand, readout.drift);
  printDrift(readout.drift);
  printWords(readout.answers, readout.bonusWords);
}

/**
 * A Seed Word that is not on the schedule, so a replacement can be read before
 * it is committed to. The pasteable entry is the point: it saves the editor
 * hand-typing a Rhyme Key in ARPAbet and forgetting the counts beside it.
 */
export function audition(schedule: Schedule, seed: string): void {
  let pinned: SeedWord;
  try {
    pinned = builtIndex().pinSeed(seed);
  } catch (error) {
    fail(message(error));
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

/** All a word list needs to be printed as columns. */
interface Listable {
  word: string;
}

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

/**
 * Typed on the one field the columns read, so the day's payload and an
 * audition's raw `PuzzleEntry` list both render through this rather than one of
 * them being converted to suit the printer.
 */
function printWords(answers: Listable[], bonusWords: Listable[]): void {
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
function printColumns(entries: Listable[]): void {
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

/**
 * The agreement check, rendered. A scheduled Seed the built index cannot pin to
 * the key the schedule records is the failure that reaches players as a silent
 * Free Play, so it is the one thing here that must be impossible to skim past —
 * on a terminal that means stderr and a non-zero exit rather than a line in the
 * scroll. The browser ranks the same case above drift instead.
 */
function failDisagreement(readout: UnpinnableDayReadout): never {
  fail(
    `SCHEDULE / INDEX DISAGREEMENT on ${readout.date} (${readout.weekday}).\n` +
      `  Seed Word "${readout.seed}" cannot be pinned to ${readout.scheduledRhymeKey} ` +
      `in the built index.\n` +
      `  ${readout.detail}\n` +
      `  A player asking for this date would be handed Free Play instead, silently.\n` +
      `  Fix the schedule entry or rebuild the index (npm run build:index).`,
  );
}
