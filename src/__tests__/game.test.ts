/**
 * The Game facade suite. `Game` bundles the `(PuzzleContext, PlayState)` pair the
 * session core threads through every accessor, exposing `score()` / `rank()` /
 * `progress()` / `missedAnswers()` / `submit()` / `toResult()` as methods so
 * callers stop passing both. The facade is a thin convenience over `session.ts`;
 * this suite asserts each method matches its underlying pure function exactly and
 * that `submit` threads state immutably — the deep behaviour already lives in
 * `session.test.ts`, so here we only pin the delegation and the value semantics.
 */

import { describe, expect, it } from "vitest";
import { makeTestIndex } from "../__fixtures__/index.ts";
import {
  applySubmission,
  DEFAULT_SCORING_CONFIG,
  emptyPlayState,
  missedAnswers,
  progress,
  rank,
  score,
  startSession,
  toResult,
  type PlayState,
  type ScoringConfig,
} from "../session.ts";
import { Game, startGame } from "../game.ts";

// Mirror session.test.ts: a fixture-appropriate rare cutoff so `defenestrate`
// is the only rare Answer and maxScore is the legible 54.
const CONFIG: ScoringConfig = { ...DEFAULT_SCORING_CONFIG, rareKnownnessCutoff: 1.55 };

describe("Game facade over the session core", () => {
  const index = makeTestIndex();
  // The reference context/state the facade must match, method for function.
  const context = startSession(index, "ate", CONFIG);

  it("startGame builds an empty Game over a fresh context", () => {
    const game = startGame(index, "ate", CONFIG);
    expect(game.context).toEqual(context);
    expect(game.state).toEqual(emptyPlayState);
    expect(game.maxScore).toBe(context.maxScore);
    expect(game.puzzle).toBe(game.context.puzzle);
    expect(game.seed).toEqual(context.seed);
    expect(game.score()).toBe(0);
    expect(game.rank().tier).toBe(0);
  });

  it("submit returns a new Game carrying the found word, leaving the original intact", () => {
    const game = startGame(index, "ate", CONFIG);
    const { game: next, result } = game.submit("late");

    // The accepted Answer advances a brand-new Game...
    expect(next).not.toBe(game);
    expect(result.verdict.outcome).toBe("answer");
    expect(next.foundAnswers).toEqual(["late"]);
    expect(next.score()).toBe(score(context, next.state));

    // ...while the original Game is untouched (a value, not a mutable cell).
    expect(game.foundAnswers).toEqual([]);
    expect(game.score()).toBe(0);
  });

  it("submit returns the very same Game instance on a rejection", () => {
    const game = startGame(index, "ate", CONFIG);
    const { game: next, result } = game.submit("hat");
    expect(result.verdict.outcome).toBe("rejected");
    expect(next).toBe(game);
  });

  it("every accessor matches its underlying session function for the same finds", () => {
    // Play a short line through both the facade and the raw core, then compare.
    let game = startGame(index, "ate", CONFIG);
    let state: PlayState = emptyPlayState;
    for (const word of ["late", "defenestrate", "eight", "objurgate"]) {
      game = game.submit(word).game;
      state = applySubmission(context, state, word).state;
    }

    expect(game.state).toEqual(state);
    expect(game.score()).toBe(score(context, state));
    expect(game.rank()).toEqual(rank(context, state));
    expect(game.progress()).toEqual(progress(context, state));
    expect(game.missedAnswers()).toEqual(missedAnswers(context, state));
    expect(game.pointsFor("defenestrate")).toBe(context.answerScores.get("defenestrate"));
    expect(game.toResult({ date: "2026-07-26" })).toEqual(
      toResult(context, state, { date: "2026-07-26" }),
    );
  });

  it("can be rehydrated from a context and a saved PlayState", () => {
    const saved: PlayState = { foundAnswers: ["late", "gate"], foundBonus: ["objurgate"] };
    const game = new Game(context, saved);
    expect(game.foundAnswers).toEqual(["late", "gate"]);
    expect(game.foundBonus).toEqual(["objurgate"]);
    expect(game.score()).toBe(score(context, saved));
  });
});
