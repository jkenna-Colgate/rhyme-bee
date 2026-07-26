/**
 * A playable terminal REPL over one real Puzzle, so a human can finally *feel*
 * whether rhyme-hunting is fun.
 *
 *   npm run play                     # a random in-band Puzzle
 *   npm run play -- --day 3           # a Puzzle of weekday-3 Difficulty
 *   npm run play -- --seed book       # replay a specific Seed Word
 *
 * On Windows PowerShell the bare `--` separator (and the token after it) is
 * stripped before npm forwards anything, so `--day 3` never reaches the script.
 * Use the equals form, which survives it, or invoke tsx directly:
 *
 *   npm run play -- --day=3           # equals form — works in PowerShell
 *   npx tsx scripts/play.ts --day 3   # bypasses npm's `--` handling entirely
 *
 * The playable size band is set by the BAND_MIN / BAND_MAX env vars (default
 * 20 / 120), mirroring `histogram`; narrow or widen it to change the candidate
 * pool the Seed Word is drawn from.
 *
 * Deserialises the built index (from `npm run build:index`), picks a Seed Word —
 * by precedence `--seed` > `--day` > random — announces it (respelled, with its
 * Answer count, maximum Score, and day/Difficulty tier), then judges each typed
 * Submission exactly as the game will, printing points, running Score, Rank, a
 * banner on a Rank change, and progress. `:quit` (or Ctrl-D) prints the durable
 * result and reveals the Answers that were missed.
 *
 * The `--day 1..7` knob sorts the in-band candidates by their curation Difficulty
 * (ADR-0007) into seven equal quantile buckets — day 1 easiest, day 7 hardest —
 * and draws at random from the requested bucket, so a human can summon an easy or
 * hard Puzzle and feel whether the metric tracks how hard it actually plays.
 * Buckets are quantiles only; fixing absolute Difficulty thresholds is the
 * deferred scheduler's job.
 *
 * A throwaway imperative shell: the whole game in progress lives in one `Game`
 * local, and all game logic runs through the tested session core the facade wraps
 * (`startGame` -> `game.submit` -> `game.score()` / `rank()` / `progress()` /
 * `toResult()`); the Difficulty itself comes from the tested `curate`. The script
 * carries no game logic of its own and is left untested, exactly as `build-index`
 * and `histogram` are.
 */

import { createInterface } from "node:readline";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PLAYABLE_BAND, playableSeeds, type FamilyEntry } from "../src/curation.ts";
import { loadRhymeIndex } from "../src/loader.ts";
import type { SeedWord } from "../src/rhymeIndex.ts";
import { isAccepted } from "../src/verdict.ts";
import { DAYS, parsePlayArgs, type PlayArgs } from "./playArgs.ts";
import { Game, startGame } from "../src/game.ts";
import type { SubmissionResult } from "../src/session.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const index = loadRhymeIndex(resolve(root, "dist-data/index.json"));

// The playable size band — the same knobs `histogram` exposes, defaulting to the
// shared `DEFAULT_PLAYABLE_BAND` the web shell also draws from.
const BAND_MIN = Number(process.env.BAND_MIN ?? DEFAULT_PLAYABLE_BAND.min);
const BAND_MAX = Number(process.env.BAND_MAX ?? DEFAULT_PLAYABLE_BAND.max);

const candidates = playableSeeds(index, { min: BAND_MIN, max: BAND_MAX });
if (candidates.length === 0) {
  console.error(`No in-band candidates in [${BAND_MIN}, ${BAND_MAX}]. Widen the band.`);
  process.exit(1);
}

// Sort candidates by Difficulty once and cut them into DAYS equal quantile
// buckets (day 1 easiest -> day 7 hardest). `dayByKey` lets the banner name the
// tier of whatever Puzzle we end up playing, however it was chosen.
const byDifficulty = [...candidates].sort((a, b) => a.difficulty - b.difficulty);
const { buckets, dayByKey } = bucketByQuantile(byDifficulty, DAYS);

let args: PlayArgs;
try {
  args = parsePlayArgs(process.argv.slice(2));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
const chosen = selectSeed(args);
let game = startGame(index, chosen.seed);

printBanner(game, chosen.family);

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

  const applied = game.submit(submission);
  game = applied.game;
  printSubmission(game, applied.result);
  rl.prompt();
});

rl.on("close", () => {
  printFinish(game);
  process.exit(0);
});

// --- selection (thin wiring over the tested Difficulty metric and session) -----

interface Selection {
  seed: string | SeedWord;
  /** The in-band candidate being played, if the Seed is one — for the tier line. */
  family?: FamilyEntry;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Precedence: explicit `--seed` > `--day` bucket draw > random in-band candidate. */
function selectSeed(args: PlayArgs): Selection {
  if (args.seed !== undefined) {
    let pinned: SeedWord;
    try {
      pinned = index.pinSeed(args.seed);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
    // Match the candidate sharing this Rhyme Key, if any, so the banner can name
    // its tier; an off-schedule Seed still plays, just without one.
    const family = candidates.find((c) => c.rhymeKey === pinned.rhymeKey);
    return { seed: pinned, family };
  }
  if (args.day !== undefined) {
    const bucket = buckets[args.day - 1]!;
    if (bucket.length === 0) fail(`No candidates in day ${args.day}. Widen the band.`);
    const family = pickRandom(bucket);
    return { seed: family.representative, family };
  }
  const family = pickRandom(candidates);
  return { seed: family.representative, family };
}

/**
 * Cut `sorted` (ascending Difficulty) into `days` equal quantile buckets. Each
 * boundary is `floor(d · n / days)`, so with n ≥ days every bucket is populated
 * against an unknown distribution — the property quantiles buy us over fixed
 * thresholds, which are deferred to the scheduler (ADR-0007).
 */
function bucketByQuantile(
  sorted: FamilyEntry[],
  days: number,
): { buckets: FamilyEntry[][]; dayByKey: Map<string, number> } {
  const n = sorted.length;
  const buckets: FamilyEntry[][] = [];
  const dayByKey = new Map<string, number>();
  for (let d = 0; d < days; d++) {
    const bucket = sorted.slice(Math.floor((d * n) / days), Math.floor(((d + 1) * n) / days));
    buckets.push(bucket);
    for (const family of bucket) dayByKey.set(family.rhymeKey, d + 1);
  }
  return { buckets, dayByKey };
}

// --- presentation (no game logic; every value comes from the session core) -----

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function printBanner(game: Game, family: FamilyEntry | undefined): void {
  const { puzzle, maxScore } = game;
  console.log("");
  console.log(`  Seed Word:  ${puzzle.seed.word}  —  spoken "${puzzle.seedRespelling}"`);
  console.log(`  Find words that rhyme with it.`);
  console.log(`  ${puzzle.answers.length} Answers · max Score ${maxScore}`);
  console.log(`  ${tierLine(family)}`);
  console.log(`  (replay this Puzzle:  npm run play -- --seed=${puzzle.seed.word})`);
  console.log(`  Type a word, or :quit to finish and reveal the misses.`);
  console.log("");
}

/** The Difficulty / weekday tier of the Puzzle being played, for the banner. */
function tierLine(family: FamilyEntry | undefined): string {
  if (family === undefined) return `Difficulty: off-schedule (not an in-band candidate)`;
  const day = dayByKey.get(family.rhymeKey);
  const dayLabel =
    day === undefined ? "" : `  ·  Day ${day} of ${DAYS} (1 easiest … ${DAYS} hardest)`;
  return `Difficulty ${family.difficulty.toFixed(2)}${dayLabel}`;
}

function printSubmission(game: Game, result: SubmissionResult): void {
  const { verdict, word, scoreDelta } = result;
  if (!isAccepted(verdict)) {
    console.log(`  ✗ ${word} — rejected: ${verdict.reason}`);
    return;
  }

  const badge = verdict.outcome === "answer" ? "✓ ANSWER" : "★ BONUS ";
  const current = game.rank();
  const { found, totalAnswers, foundBonus } = game.progress();
  console.log(
    `  ${badge} ${word} (+${scoreDelta})  ` +
      `Score ${game.score()}/${game.maxScore}  ` +
      `Rank ${current.label}  ·  Answers ${found}/${totalAnswers} · Bonus ${foundBonus}`,
  );
  if (result.rankChange) {
    console.log(`  *** New Rank: ${result.rankChange.to.label}! ***`);
  }
}

function printFinish(game: Game): void {
  const today = new Date().toISOString().slice(0, 10);
  const result = game.toResult({ date: today });
  console.log("");
  console.log("  ── Final ──────────────────────────────────");
  console.log(`  Seed Word:   ${result.seed}`);
  console.log(`  Final Score: ${result.finalScore}/${game.maxScore}`);
  console.log(`  Final Rank:  ${result.finalRank.label}`);
  console.log(`  Answers:     ${result.found}/${result.totalAnswers}`);

  const missed = game.missedAnswers();
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
