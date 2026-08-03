/**
 * Slice: the two facts the clients used to derive for themselves.
 *
 * The Session's outcome — in progress, complete, or given up — was computed one
 * way in the web shell and another in the REPL, and the shell's copy sat in the
 * least tested file in the repo. The plain-English rejection lines were worse:
 * they existed only inside a view, so the REPL printed the machine reason at the
 * player. Both now live in the core, which means both can be tested without a
 * browser. That is what this file is for.
 */

import { describe, expect, it } from "vitest";
import { makeTestIndex } from "../__fixtures__/index.ts";
import { Session } from "../session.ts";
import { REJECTION_MESSAGE, type RejectionReason } from "../verdict.ts";

const index = makeTestIndex();

/** Play every Answer of a Puzzle, in the Puzzle's own order. */
function findEveryAnswer(session: Session): Session {
  let current = session;
  for (const answer of session.puzzle.answers) {
    current = current.submit(answer.word).session;
  }
  return current;
}

describe("a Session names its own outcome", () => {
  it("reports a fresh Session as in progress", () => {
    expect(Session.start(index, "ate").outcome()).toBe("in-progress");
  });

  it("reports in progress while Answers remain", () => {
    const { session } = Session.start(index, "ate").submit("late");
    expect(session.progress().found).toBe(1);
    expect(session.outcome()).toBe("in-progress");
  });

  it("reports complete when the last Answer is found", () => {
    const finished = findEveryAnswer(Session.start(index, "ate"));
    expect(finished.progress().found).toBe(finished.progress().totalAnswers);
    expect(finished.outcome()).toBe("complete");
  });

  it("reports given up when the Reveal is taken with Answers missing", () => {
    const session = Session.start(index, "ate").submit("late").session;
    expect(session.end().outcome()).toBe("given-up");
  });

  it("stays complete when the Reveal is taken after finishing", () => {
    // Asking for the Bonus Words having already found every Answer is not
    // giving up, and the outcome must not call it that.
    const finished = findEveryAnswer(Session.start(index, "ate"));
    expect(finished.end().outcome()).toBe("complete");
  });

  it("is unmoved by a Bonus Word found after the last Answer", () => {
    // The completion overlay is a rising edge on this value, so a Bonus Word
    // collected afterwards must not take the outcome away and hand it back.
    const finished = findEveryAnswer(Session.start(index, "ate"));
    const bonus = finished.puzzle.bonusWords[0];
    expect(bonus).toBeDefined();
    const after = finished.submit(bonus!.word).session;
    expect(after.foundBonus).toContain(bonus!.word);
    expect(after.outcome()).toBe("complete");
  });

  it("does not count a Bonus Word toward completion", () => {
    const session = Session.start(index, "ate");
    const bonus = session.puzzle.bonusWords[0]!;
    const after = session.submit(bonus.word).session;
    expect(after.foundBonus).toContain(bonus.word);
    expect(after.outcome()).toBe("in-progress");
  });

  it("reports a fresh Session for a different Puzzle as in progress", () => {
    // Completion is per-Session: finishing `ate` says nothing about `bed`.
    findEveryAnswer(Session.start(index, "ate"));
    expect(Session.start(index, "bed").outcome()).toBe("in-progress");
  });
});

describe("one rejection-message table serves both clients", () => {
  // The closed set, written out. `Record<RejectionReason, string>` already makes
  // the table exhaustive at compile time; this asserts the union has not grown a
  // member that slipped past review with a placeholder.
  const reasons: RejectionReason[] = [
    "is-the-seed-word",
    "already-submitted",
    "malformed",
    "not-a-known-word",
    "proper-noun",
    "does-not-rhyme",
  ];

  it("covers every rejection reason", () => {
    expect(Object.keys(REJECTION_MESSAGE).sort()).toEqual([...reasons].sort());
  });

  it.each(reasons)("says something a player can read for %j", (reason) => {
    const message = REJECTION_MESSAGE[reason];
    expect(message).toBeTruthy();
    // A machine reason leaking through is the failure this replaced.
    expect(message).not.toContain("-");
  });

  it("has a message for every rejection the engine actually issues", () => {
    const session = Session.start(index, "ate");
    const submissions = ["ate", "hat", "kate", "zzzz", "l8", "late"];
    for (const word of submissions) {
      const { verdict } = session.submit(word).result!;
      if (verdict.outcome !== "rejected") continue;
      expect(REJECTION_MESSAGE[verdict.reason]).toBeTruthy();
    }
  });
});
