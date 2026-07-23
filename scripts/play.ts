/**
 * A playable terminal REPL over one real Puzzle, so a human can finally *feel*
 * whether rhyme-hunting is fun.
 *
 *   npm run play
 *
 * Deserialises the built index (from `npm run build:index`), picks a random
 * in-band Seed Word, announces it — respelled, with its Answer count and maximum
 * Score — then judges each typed Submission exactly as the game will, printing
 * points, running Score, Rank, a banner on a Rank change, and progress. `:quit`
 * (or Ctrl-D) prints the durable result and reveals the Answers that were missed.
 *
 * A throwaway imperative shell: play-state lives in one local variable and all
 * game logic runs through the tested session core (`startSession` /
 * `applySubmission` / `score` / `rank` / `progress` / `toResult`). It carries no
 * game logic of its own and is left untested, exactly as `build-index` and
 * `histogram` are.
 */

import { createInterface } from "node:readline";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { curate } from "../src/curation.ts";
import { loadRhymeIndex } from "../src/loader.ts";
import { isAccepted } from "../src/verdict.ts";
import {
  applySubmission,
  emptyPlayState,
  progress,
  rank,
  score,
  startSession,
  toResult,
  type PlayState,
  type PuzzleContext,
  type SubmissionResult,
} from "../src/session.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const index = loadRhymeIndex(resolve(root, "dist-data/index.json"));

// The playable size band — the same knobs `histogram` exposes.
const BAND_MIN = Number(process.env.BAND_MIN ?? "20");
const BAND_MAX = Number(process.env.BAND_MAX ?? "120");

const candidates = curate(index, { sizeBand: { min: BAND_MIN, max: BAND_MAX } }).candidates;
if (candidates.length === 0) {
  console.error(`No in-band candidates in [${BAND_MIN}, ${BAND_MAX}]. Widen the band.`);
  process.exit(1);
}

const chosen = pickRandom(candidates);
const context = startSession(index, chosen.representative);
let state: PlayState = emptyPlayState;

printBanner(context);

const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
rl.prompt();

rl.on("line", (line) => {
  const submission = line.trim();
  if (submission === "") {
    rl.prompt();
    return;
  }
  if (submission === ":quit" || submission === ":q") {
    rl.close();
    return;
  }

  const applied = applySubmission(context, state, submission);
  state = applied.state;
  printSubmission(context, state, applied.result);
  rl.prompt();
});

rl.on("close", () => {
  printFinish(context, state);
  process.exit(0);
});

// --- presentation (no game logic; every value comes from the session core) -----

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function printBanner(context: PuzzleContext): void {
  const { puzzle, maxScore } = context;
  console.log("");
  console.log(`  Seed Word:  ${puzzle.seed.word}  —  spoken "${puzzle.seedRespelling}"`);
  console.log(`  Find words that rhyme with it.`);
  console.log(`  ${puzzle.answers.length} Answers · max Score ${maxScore}`);
  console.log(`  (Seed Word for replay: ${puzzle.seed.word})`);
  console.log(`  Type a word, or :quit to finish and reveal the misses.`);
  console.log("");
}

function printSubmission(context: PuzzleContext, state: PlayState, result: SubmissionResult): void {
  const { verdict, word, scoreDelta } = result;
  if (!isAccepted(verdict)) {
    console.log(`  ✗ ${word} — rejected: ${verdict.reason}`);
    return;
  }

  const badge = verdict.outcome === "answer" ? "✓ ANSWER" : "★ BONUS ";
  const current = rank(context, state);
  const { found, totalAnswers, foundBonus } = progress(context, state);
  console.log(
    `  ${badge} ${word} (+${scoreDelta})  ` +
      `Score ${score(context, state)}/${context.maxScore}  ` +
      `Rank ${current.label}  ·  Answers ${found}/${totalAnswers} · Bonus ${foundBonus}`,
  );
  if (result.rankChange) {
    console.log(`  *** New Rank: ${result.rankChange.to.label}! ***`);
  }
}

function printFinish(context: PuzzleContext, state: PlayState): void {
  const today = new Date().toISOString().slice(0, 10);
  const result = toResult(context, state, { date: today });
  console.log("");
  console.log("  ── Final ──────────────────────────────────");
  console.log(`  Seed Word:   ${result.seed}`);
  console.log(`  Final Score: ${result.finalScore}/${context.maxScore}`);
  console.log(`  Final Rank:  ${result.finalRank.label}`);
  console.log(`  Answers:     ${result.found}/${result.totalAnswers}`);

  const found = new Set(state.foundAnswers);
  const missed = context.puzzle.answers.filter((a) => !found.has(a.word));
  if (missed.length === 0) {
    console.log(`  You found every Answer. Perfect game.`);
  } else {
    console.log(`  Missed Answers (${missed.length}):`);
    for (const answer of missed) {
      console.log(`    ${answer.word}  —  "${answer.respelling}"`);
    }
  }
  console.log("");
}
