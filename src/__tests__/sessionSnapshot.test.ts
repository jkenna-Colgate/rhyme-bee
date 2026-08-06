/**
 * The session-snapshot suite. The claim under test is the one the whole
 * persistence design exists for: what is stored is the raw Submissions, never
 * the verdicts, so a Session replayed through a corrected judge *heals* — a word
 * wrongly rejected on Monday starts counting the next time the player opens the
 * game, with no action from them.
 */

import { describe, expect, it } from "vitest";
import { makeTestIndex } from "../__fixtures__/index.ts";
import type { RhymeIndex } from "../rhymeIndex.ts";
import { Session } from "../session.ts";
import { resume, snapshot, snapshotKey } from "../sessionSnapshot.ts";

const DATE = "2026-08-10";

/** Drive a Session through a list of Submissions, as the shell's hook does. */
function play(index: RhymeIndex, seed: string, submissions: string[]): Session {
  let session = Session.start(index, index.pinSeed(seed));
  for (const word of submissions) session = session.submit(word).session;
  return session;
}

describe("healing: a corrected judge reaches a Session already played", () => {
  // `prate` rhymes with `ate` and is a word the player knows. The judge that
  // rejected it had no reading for it; the maintainer judges one into the
  // supplement and rebuilds. Nothing else about the two indexes differs.
  const withoutReading = makeTestIndex({ words: ["prate"], prevalence: [["prate", 2.2]] });
  const withReading = makeTestIndex({
    words: ["prate"],
    prevalence: [["prate", 2.2]],
    pronunciations: [["prate", [["P", "R", "EY1", "T"]]]],
  });

  it("replays a Submission rejected under one index as an Answer under a corrected one", () => {
    const monday = play(withoutReading, "ate", ["late", "prate"]);
    expect(monday.foundAnswers).toEqual(["late"]);

    const raw = snapshot(
      { session: monday, submissions: ["late", "prate"] },
      { date: DATE },
    );

    const wednesday = resume(withReading, withReading.pinSeed("ate"), raw);
    expect(wednesday.session.foundAnswers).toEqual(["late", "prate"]);
    expect(wednesday.session.score()).toBe(monday.score() + wednesday.session.pointsFor("prate"));
  });
});

// --- Totality: every unusable input is a fresh Session, never an error --------

describe("resume always returns a playable Session", () => {
  const index = makeTestIndex();
  const seed = index.pinSeed("ate");

  // A snapshot of a real Session, taken apart to make each malformed case out of
  // something that was once valid rather than out of invented noise.
  const good = snapshot(
    { session: play(index, "ate", ["late", "eight"]), submissions: ["late", "eight"] },
    { date: DATE },
  );

  const unusable: [string, string | null][] = [
    ["absent", null],
    ["empty", ""],
    ["non-JSON", "not json at all"],
    ["truncated", good.slice(0, Math.floor(good.length / 2))],
    ["unknown-version", good.replace('"version":1', '"version":99')],
    ["wrong-shape", JSON.stringify({ version: 1, date: DATE, seed, submissions: "late" })],
    ["Seed-mismatched", good.replace('"ate"', '"bed"')],
  ];

  it.each(unusable)("collapses %s input to a fresh Session", (_case, raw) => {
    const resumed = resume(index, seed, raw);
    expect(resumed.session.foundAnswers).toEqual([]);
    expect(resumed.session.foundBonus).toEqual([]);
    expect(resumed.session.ended).toBe(false);
    expect(resumed.session.score()).toBe(0);
    expect(resumed.submissions).toEqual([]);
    // Playable, not merely constructed: it still takes a Submission.
    expect(resumed.session.submit("late").session.foundAnswers).toEqual(["late"]);
  });
});

// --- The round trip: a resumed Session is the one the player left ------------

describe("a Session comes back as it was left", () => {
  const index = makeTestIndex();
  const seed = index.pinSeed("ate");
  // Answers, a Bonus Word, and a rejection in the middle — the rejection is the
  // reason the log is stored raw, so it has to survive the round trip too.
  const submissions = ["late", "objurgate", "hat", "defenestrate"];
  const left = play(index, "ate", submissions);

  const resumed = resume(index, seed, snapshot({ session: left, submissions }, { date: DATE }));

  it("restores the found Answers and Bonus Words, in the order they were found", () => {
    expect(resumed.session.foundAnswers).toEqual([...left.foundAnswers]);
    expect(resumed.session.foundBonus).toEqual([...left.foundBonus]);
    expect(resumed.session.foundBonus).toEqual(["objurgate"]);
  });

  it("restores Score, Rank and progress", () => {
    expect(resumed.session.score()).toBe(left.score());
    expect(resumed.session.rank()).toEqual(left.rank());
    expect(resumed.session.progress()).toEqual(left.progress());
    expect(resumed.session.outcome()).toBe(left.outcome());
  });

  it("keeps the raw Submissions, refusals included, so the next snapshot still heals", () => {
    expect(resumed.submissions).toEqual(submissions);
  });

  it("replays silently: it hands back state, never verdicts to render", () => {
    // The four Submissions above produced four `SubmissionResult`s when they were
    // first played, one of them a Rank change. A resume returns none of them —
    // there is nowhere in its result for a verdict to travel — so a returning
    // player is not shown a burst of stale feedback, and the shell has nothing to
    // advance its per-Submission sequence counter with.
    expect(Object.keys(resumed).sort()).toEqual(["session", "submissions"]);
  });

  it("carries on: a Submission after the resume lands on top of the restored finds", () => {
    const next = resumed.session.submit("eight").session;
    expect(next.foundAnswers).toEqual([...left.foundAnswers, "eight"]);
  });
});

describe("the Reveal survives a reload", () => {
  const index = makeTestIndex();
  const seed = index.pinSeed("ate");
  const submissions = ["late"];
  const given = play(index, "ate", submissions).end();

  const resumed = resume(index, seed, snapshot({ session: given, submissions }, { date: DATE }));

  it("resumes ended, so the player cannot carry on with the answer sheet", () => {
    expect(resumed.session.ended).toBe(true);
    expect(resumed.session.outcome()).toBe("given-up");
    expect(resumed.session.submit("eight").result).toBeNull();
  });

  it("freezes the Score and Rank the Reveal froze", () => {
    expect(resumed.session.score()).toBe(given.score());
    expect(resumed.session.rank()).toEqual(given.rank());
  });
});

// --- The key: derived from the schedule date, and from nothing else ----------

describe("the snapshot key derives from the schedule date", () => {
  it("gives each scheduled day its own key", () => {
    expect(snapshotKey("2026-08-10")).not.toBe(snapshotKey("2026-08-11"));
  });

  it("gives the same day the same key every time, so writer and reader agree", () => {
    expect(snapshotKey("2026-08-10")).toBe(snapshotKey("2026-08-10"));
    expect(snapshotKey("2026-08-10")).toContain("2026-08-10");
  });
});

describe("yesterday's Session does not restore into today's Puzzle", () => {
  const index = makeTestIndex();

  it("is filed under a key of its own", () => {
    expect(snapshotKey("2026-08-10")).not.toBe(snapshotKey("2026-08-11"));
  });

  it("is discarded even when it is read under today's Seed", () => {
    const yesterday = play(index, "bed", ["read"]);
    expect(yesterday.foundAnswers).toEqual(["read"]);
    const stale = snapshot({ session: yesterday, submissions: ["read"] }, { date: "2026-08-10" });

    const today = resume(index, index.pinSeed("ate"), stale);
    expect(today.session.foundAnswers).toEqual([]);
    expect(today.submissions).toEqual([]);
  });
});
