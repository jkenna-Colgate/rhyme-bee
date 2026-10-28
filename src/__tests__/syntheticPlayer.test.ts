/**
 * The Synthetic Player as an instrument (#250): its prompt, how its word list is
 * read, and its play loop, which submits every word to the real engine through
 * `session.ts` and hands on the Candidates. Played on the fixture `ate` Puzzle,
 * whose Answers and points `session.test.ts` sets out.
 */

import { describe, expect, it } from "vitest";
import { makeTestIndex } from "../__fixtures__/index.ts";
import { DEFAULT_SCORING_CONFIG, startSession } from "../session.ts";
import { parsePlayerReply, playerPrompt, playWords } from "../syntheticPlayer.ts";

// Only `defenestrate` is rare at this cutoff, so the maximum Score is 54.
const context = () => startSession(makeTestIndex(), "ate", { ...DEFAULT_SCORING_CONFIG, rareKnownnessCutoff: 1.55 });

describe("the player prompt", () => {
  it("shows the Seed Word with its respelling, as the game does, and asks for words only", () => {
    const prompt = playerPrompt("ate", "AYT");

    expect(prompt).toContain('\n  "ate" (pronounced AYT)\n');
    expect(prompt).toContain("Names don't count.");
    expect(prompt.endsWith("Output only the words, one per line, lowercase, nothing else.")).toBe(true);
  });
});

describe("reading the player's reply", () => {
  it("takes one word per line, lower-cased, with any list marks taken off", () => {
    expect(parsePlayerReply("late\n- Gate\n3. eight\r\n* crate\n")).toEqual(["late", "gate", "eight", "crate"]);
  });

  it("drops lines that are not words", () => {
    expect(parsePlayerReply("Here are my words:\nlate\n\n(that's all)\nfree-fall")).toEqual(["late", "free-fall"]);
  });
});

describe("the play loop", () => {
  it("submits every word in order and reports each verdict", () => {
    const play = playWords(context(), ["late", "late", "hat"]);

    expect(play.submissions.map((s) => [s.word, s.verdict.outcome === "rejected" ? s.verdict.reason : s.verdict.outcome])).toEqual([
      ["late", "answer"],
      ["late", "already-submitted"],
      ["hat", "does-not-rhyme"],
    ]);
  });

  it("hands on as Candidates every attempted rhyme not counted as an Answer", () => {
    const play = playWords(context(), ["late", "hat", "grates", "late", "ate", "objurgate", "kate", "chocolate", "free-fall"]);

    // The repeat, the Seed Word itself and the malformed entry were never rhymes the game refused.
    expect(play.candidates.map((c) => c.word)).toEqual(["hat", "grates", "objurgate", "kate", "chocolate"]);
  });

  it("states the share of the maximum Score reached", () => {
    const play = playWords(context(), ["late", "eight", "objurgate"]);

    expect([play.score, play.maxScore]).toEqual([9, 54]);
    expect(play.share).toBeCloseTo(9 / 54);
    // 17% of the maximum, which the default ladder names Silver Tongue (15%).
    expect(play.rank).toBe("Silver Tongue");
  });
});
