/**
 * The Decline gesture as a value: which of the three rulings writes which file,
 * what the editor is told before taking one, and which acts a Candidate's state
 * offers at all.
 *
 * All of it is pure and none of it is transport — the endpoint is
 * `editorDeclineEndpoint.test.ts`, the file is `declinesFile.test.ts`, the
 * format is `src/__tests__/declines.test.ts`. What is held to account here is
 * the part that would otherwise live only inside JSX, where nothing could reach
 * it: `showsDemotionReassurance` in `demote.ts` is the same split for the same
 * reason, and the Proper Noun warning is why it matters here — a sentence the
 * ticket requires the editor to read *before* they click is worth a test that
 * fails when it stops being said.
 */

import { describe, expect, it } from "vitest";
import { isOutstanding, type ReadCandidate } from "../../scripts/editorCandidates.ts";
import { DEMOTION_REASONS } from "../../src/demotions.ts";
import type { SupplementCandidate } from "../../src/supplementCandidate.ts";
import {
  DECLINE_CHOICES,
  DECLINE_CONSEQUENCE,
  DECLINE_LABEL,
  declineWrites,
  isDemotionDecline,
} from "../src/editor/decline.ts";
import { offersAdd } from "../src/editor/dayCandidates.ts";

const RECORD: SupplementCandidate = {
  word: "frocked",
  seedWord: "docked",
  seedRhymeKey: "AA K T",
  reason: "not-a-known-word",
  engineRespelling: null,
  timestamp: "2026-07-02T10:00:00.000Z",
};

function candidate(state: ReadCandidate["state"]): ReadCandidate {
  const identity = { word: RECORD.word, candidate: RECORD };
  switch (state) {
    case "resolved":
      return { ...identity, state, readings: [] };
    case "declined":
      return { ...identity, state };
    case "is-a-name":
      return { ...identity, state };
    case "needs-correction":
      return { ...identity, state, readings: [] };
    case "addable":
      return { ...identity, state, readings: [], relatives: [], composed: null };
  }
}

describe("the three rulings the gesture offers", () => {
  it("offers exactly the two demotion reasons plus the engine's own", () => {
    expect(DECLINE_CHOICES).toEqual([...DEMOTION_REASONS, "reason-is-correct"]);
  });

  /**
   * The ticket's central constraint: two of the three are the *existing* demote
   * gesture and the third is the only one the new file records. Nothing here may
   * ever write both.
   */
  it("sends a Proper Noun and junk to the demotion list, and nothing else there", () => {
    expect(declineWrites("proper-noun")).toBe("demotion");
    expect(declineWrites("not-a-known-word")).toBe("demotion");
    expect(isDemotionDecline("proper-noun")).toBe(true);
    expect(isDemotionDecline("not-a-known-word")).toBe(true);
  });

  it("sends only the already-correct reason to the Declines file", () => {
    expect(declineWrites("reason-is-correct")).toBe("decline");
    expect(isDemotionDecline("reason-is-correct")).toBe(false);
    expect(DECLINE_CHOICES.filter((c) => declineWrites(c) === "decline")).toEqual([
      "reason-is-correct",
    ]);
  });

  it("names every choice for the editor rather than showing the union's spelling", () => {
    for (const choice of DECLINE_CHOICES) {
      expect(DECLINE_LABEL[choice].length).toBeGreaterThan(0);
      expect(DECLINE_LABEL[choice]).not.toBe(choice);
    }
  });
});

describe("what the editor is told before taking a ruling", () => {
  /**
   * The warning the ticket names. A Candidate is one player's report about one
   * Puzzle, and declining it as a Proper Noun takes the word's wordhood from
   * every day — so the reach has to be on the button, not in the banner
   * afterwards.
   */
  it("says a Proper Noun decline takes the word's wordhood on every day", () => {
    expect(DECLINE_CONSEQUENCE["proper-noun"]).toContain("every day");
    expect(DECLINE_CONSEQUENCE["proper-noun"]).toContain("data/demotions.txt");
  });

  /**
   * The second half of what that ruling costs, and the half an editor would
   * otherwise learn by watching the first act appear not to work.
   * `gatherEvidence.isName` asks the names data, which a demotion does not
   * change, so the card comes back reading `is-a-name` and clearing it takes a
   * second Decline.
   */
  it("says the Proper Noun decline leaves the Candidate on the queue", () => {
    expect(DECLINE_CONSEQUENCE["proper-noun"]).toContain("stays on the queue");
  });

  it("says the same of the junk decline, which reaches the same file", () => {
    expect(DECLINE_CONSEQUENCE["not-a-known-word"]).toContain("every day");
    expect(DECLINE_CONSEQUENCE["not-a-known-word"]).toContain("data/demotions.txt");
  });

  /**
   * And the opposite for the third, which is the whole reason the two files are
   * two files: a demotion changes adjudication and a Decline changes nothing.
   */
  it("says the already-correct decline writes the Declines file and nothing else", () => {
    expect(DECLINE_CONSEQUENCE["reason-is-correct"]).toContain("data/declines.txt");
    expect(DECLINE_CONSEQUENCE["reason-is-correct"]).not.toContain("data/demotions.txt");
    expect(DECLINE_CONSEQUENCE["reason-is-correct"]).toContain("No verdict changes");
  });

  it("has a consequence for every choice, so none is taken blind", () => {
    for (const choice of DECLINE_CHOICES) {
      expect(DECLINE_CONSEQUENCE[choice].length).toBeGreaterThan(0);
    }
  });
});

describe("which acts a Candidate's state offers", () => {
  it("offers the one-gesture add to an addable Candidate", () => {
    expect(offersAdd(candidate("addable"))).toBe(true);
  });

  it("offers no add where the engine already holds a reading", () => {
    // A correction, which is #180's. An add here would write a second reading
    // over a pronunciation nobody had approved replacing.
    expect(offersAdd(candidate("needs-correction"))).toBe(false);
    expect(offersAdd(candidate("resolved"))).toBe(false);
    expect(offersAdd(candidate("is-a-name"))).toBe(false);
    expect(offersAdd(candidate("declined"))).toBe(false);
  });

  /**
   * The Decline is offered on `isOutstanding` directly — there is no predicate
   * of its own for it, because there is nothing for one to decide. All three
   * rulings are reachable from every outstanding state on purpose: a name the
   * names data does not hold reads `addable` and is exactly the case the
   * demotion list exists for, and any state can turn out to be junk.
   */
  it("offers the Decline to every Candidate that still wants a ruling", () => {
    expect(isOutstanding(candidate("addable"))).toBe(true);
    expect(isOutstanding(candidate("needs-correction"))).toBe(true);
    expect(isOutstanding(candidate("is-a-name"))).toBe(true);
  });

  it("offers nothing to a Candidate already settled", () => {
    for (const state of ["resolved", "declined"] as const) {
      expect(isOutstanding(candidate(state))).toBe(false);
      expect(offersAdd(candidate(state))).toBe(false);
    }
  });
});
