/**
 * Replaying a pulled Session Record against the current Rhyme Index (ADR-0019):
 * the record carries no verdicts, so Rank, Score and each rejection with its
 * reason are read off it here.
 */

import { describe, expect, it } from "vitest";
import { makeTestIndex } from "../__fixtures__/index.ts";
import type { SessionRecord } from "../sessionRecord.ts";
import { replaySessionRecord } from "../sessionRecordReplay.ts";
import { resume, snapshot } from "../sessionSnapshot.ts";
import { Session } from "../session.ts";

const index = makeTestIndex();

const record: SessionRecord = {
  id: "0123456789abcdef0123456789abcdef",
  date: "2026-08-10",
  seed: { word: "ate", rhymeKey: "EY T" },
  submissions: ["late", "Kate", "chocolate", "zzzq", "late", "don't", "eight", "objurgate"],
  ended: false,
};

describe("replaying a Session Record", () => {
  it("gives the Rank and Score the Session reaches against the current index", () => {
    const replay = replaySessionRecord(index, record);
    if (!replay.replayed) throw new Error(replay.problem);

    // The snapshot path the game itself resumes by reaches the same Session.
    const resumed = resume(
      index,
      index.pinSeed("ate"),
      snapshot(
        { session: Session.start(index, index.pinSeed("ate")), submissions: record.submissions },
        { date: record.date },
      ),
    ).session;
    expect(replay.score).toBe(resumed.score());
    expect(replay.rank).toEqual(resumed.rank());
    expect(replay.found).toEqual({ answers: ["late", "eight"], bonus: ["objurgate"] });
    expect(replay.maxScore).toBeGreaterThan(replay.score);
  });

  it("lists each rejection in order, with its reason and the words a player was shown", () => {
    const replay = replaySessionRecord(index, record);
    if (!replay.replayed) throw new Error(replay.problem);
    expect(replay.rejections).toEqual([
      { word: "Kate", reason: "proper-noun", message: "proper nouns don’t count" },
      { word: "chocolate", reason: "does-not-rhyme", message: "not on our rhyme list" },
      { word: "zzzq", reason: "not-a-known-word", message: "not a word we know" },
      { word: "late", reason: "already-submitted", message: "you’ve already found that" },
      { word: "don't", reason: "malformed", message: "letters only, please" },
    ]);
  });

  it("gives every Submission its outcome, in the order it was typed", () => {
    const replay = replaySessionRecord(index, record);
    if (!replay.replayed) throw new Error(replay.problem);
    expect(replay.submissions.map((s) => [s.word, s.outcome])).toEqual([
      ["late", "answer"],
      ["Kate", "rejected"],
      ["chocolate", "rejected"],
      ["zzzq", "rejected"],
      ["late", "rejected"],
      ["don't", "rejected"],
      ["eight", "answer"],
      ["objurgate", "bonus"],
    ]);
  });

  it("freezes an ended Session as the Reveal left it", () => {
    const replay = replaySessionRecord(index, { ...record, ended: true });
    if (!replay.replayed) throw new Error(replay.problem);
    expect(replay.outcome).toBe("given-up");
  });

  it("says so, rather than throwing, when the index can no longer pin the Seed Word", () => {
    const replay = replaySessionRecord(index, { ...record, seed: { word: "ate", rhymeKey: "IY T" } });
    expect(replay.replayed).toBe(false);
  });
});
