/**
 * The correction gesture's browser-side rules: which modes a card offers, which
 * days it reports as moved, and how a proposal the *add* path already made is
 * read as one this card can approve.
 *
 * All three are pure and all three are rules the ticket states about the screen,
 * which is why they live in `correction.ts` rather than inside JSX — a sentence
 * or a condition that only exists in a component is one no test can reach.
 * `decline.test.ts` is the same suite for the gesture beside this one.
 */

import { describe, expect, it } from "vitest";
import { rhymeKeyOf } from "../../src/phonology.ts";
import {
  CORRECTION_MODES,
  CORRECTION_MODE_CONSEQUENCE,
  CORRECTION_REACH,
  correctionModes,
  honestReading,
  movedDays,
  type CorrectionWriteResult,
  type DayMovement,
} from "../src/editor/correction.ts";

describe("which modes a correction offers", () => {
  it("offers both when the engine holds a reading to join to", () => {
    expect(correctionModes([{ phonemes: ["G", "EY1", "T"], key: "EY T" }])).toEqual(
      CORRECTION_MODES,
    );
  });

  /**
   * The honest reading: the engine reads the word not at all, so there is no
   * second pronunciation for a join to stand alongside. Two buttons writing the
   * same line would be a choice that is not one.
   */
  it("offers only replace when there is nothing to join to", () => {
    expect(correctionModes([])).toEqual(["replace"]);
  });

  it("names the cost of each mode before either is clicked", () => {
    // Not a spelling assertion: what each sentence must carry is the *other*
    // half of the trade, because the choice is only the editor's if both risks
    // are in front of them.
    expect(CORRECTION_MODE_CONSEQUENCE.replace).toContain("legitimate second pronunciation");
    expect(CORRECTION_MODE_CONSEQUENCE.join).toContain("either pronunciation");
    expect(CORRECTION_MODE_CONSEQUENCE.join).toContain("simply wrong");
  });

  it("warns that a correction reaches every day, which is what an add does not", () => {
    expect(CORRECTION_REACH).toContain("every day");
    expect(CORRECTION_REACH).toContain("add");
  });
});

describe("a proposal the add path already made", () => {
  const AGENT_PROPOSED = ["G", "L", "IY1", "B"];

  /**
   * `agent-reading-failed-verification` is the one branch of the existing outcome
   * union that the honest-reading Decline resolves through (#176). Read as a
   * proposal, it is the same card the correction draws — nothing is asked for
   * again, because asking again would spend a minute to get a different reading
   * and throw away the one being judged.
   */
  it("is offered for approval with its own key and respelling", () => {
    const proposal = honestReading("gleeb", "EY T", AGENT_PROPOSED);

    expect(proposal).toMatchObject({
      outcome: "proposed",
      word: "gleeb",
      target: "EY T",
      current: [],
      phonemes: AGENT_PROPOSED,
      key: rhymeKeyOf(AGENT_PROPOSED),
      reaches: false,
    });
    expect(proposal.respelling.length).toBeGreaterThan(0);
  });

  it("says it does not reach the target, which is why it is the honest reading", () => {
    expect(honestReading("gleeb", "EY T", AGENT_PROPOSED).reaches).toBe(false);
    // Recomputed rather than inherited from the outcome's name: a proposal that
    // does reach the key is told the truth about itself.
    expect(honestReading("gleeb", "IY B", AGENT_PROPOSED).reaches).toBe(true);
  });

  it("offers only replace, because the engine reads the word not at all", () => {
    expect(correctionModes(honestReading("gleeb", "EY T", AGENT_PROPOSED).current)).toEqual([
      "replace",
    ]);
  });
});

describe("which days a correction reports as moved", () => {
  const still: DayMovement = {
    date: "2026-09-01",
    seed: "ate",
    rhymeKey: "EY T",
    before: { answerCount: 3, maxScore: 20, difficulty: 0.2 },
    after: { answerCount: 3, maxScore: 20, difficulty: 0.2 },
    heldBefore: true,
    heldAfter: true,
    moved: false,
  };
  const shifted: DayMovement = { ...still, date: "2026-09-02", seed: "hat", moved: true };

  const result: CorrectionWriteResult = {
    word: "gate",
    mode: "join",
    written: [["G", "EY1", "T"], ["G", "AE1", "T"]],
    keysBefore: ["EY T"],
    keysAfter: ["EY T", "AE T"],
    rechecked: ["EY T", "AE T"],
    rebuilt: { ok: true },
    days: [still, shifted],
  };

  it("names the days that moved, out of every day the recheck reached", () => {
    // `still` and `shifted` hold the word before and after and carry identical
    // figures, so `moved` is the only thing being read here — and the day comes
    // back whole, because the screen reports its figures rather than looking
    // them up again from a date.
    expect(movedDays(result)).toEqual([shifted]);
  });
});
