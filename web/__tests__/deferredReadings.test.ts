/**
 * The queue's second section as the browser selects it, and the proposal an
 * approve card is drawn over (#181). Both are pure, both are the browser's, and
 * both are tested over object literals — `dayCandidates.test.ts`'s shape, for
 * its reason.
 *
 * No state is derived here and none is recomputed: every deferral on these
 * fixtures arrives already decided, because that is how it arrives on the
 * screen. What *is* asserted is the one thing this layer builds — the
 * `CorrectionProposal` #180's approve card takes — because that is the whole of
 * the reuse, and a reuse no test reaches is a reuse that quietly becomes a
 * second approval path.
 */

import { describe, expect, it } from "vitest";
import type { CandidateQueueReadout } from "../../scripts/editorCandidates.ts";
import type { DeferredRecord, ReadDeferral } from "../../scripts/editorDeferred.ts";
import { deferredReadings, isDeferralOutstanding, proposalFor } from "../src/editor/deferredReadings.ts";

const DOCKED = "AA K T";
/** A reading that misses `AA K T` — which is what failing verification means. */
const MISSES: string[] = ["Z", "AO1", "R", "P"];

function record(word: string, over: Partial<DeferredRecord> = {}): DeferredRecord {
  return {
    word,
    rhymeKey: DOCKED,
    reason: "agent-unavailable",
    proposed: null,
    timestamp: "2026-08-12T21:00:00.000Z",
    ...over,
  };
}

const UNREACHED: ReadDeferral = {
  word: "zorp",
  rhymeKey: DOCKED,
  record: record("zorp"),
  state: "unreached",
};

const PROPOSED: ReadDeferral = {
  word: "zorp",
  rhymeKey: DOCKED,
  record: record("zorp", { reason: "agent-reading-failed-verification", proposed: MISSES }),
  state: "proposed",
  proposed: MISSES,
};

const ANSWERED: ReadDeferral = {
  word: "docked",
  rhymeKey: DOCKED,
  record: record("docked"),
  state: "answered",
  readings: [{ phonemes: ["D", "AA1", "K", "T"], key: DOCKED }],
};

const QUEUE: CandidateQueueReadout = {
  total: 0,
  outstanding: 0,
  newest: null,
  groups: [],
  deferred: { entries: [UNREACHED, PROPOSED, ANSWERED], outstanding: 2 },
};

describe("the second section's selection", () => {
  // A queue that has not loaded and one whose deferred file is empty are the
  // same thing to render: an empty section, never an error.
  it("answers a queue that has not loaded with an empty section", () => {
    expect(deferredReadings(null)).toEqual({ entries: [], outstanding: 0 });
  });

  // The count on the section is the module's own decision about which deferrals
  // still want the editor, so it is what the filter is held to rather than a
  // number this test also knows.
  it("leaves the answered deferral out of what still wants the editor", () => {
    const section = deferredReadings(QUEUE);
    const wanting = section.entries.filter(isDeferralOutstanding);

    expect(wanting).toEqual([UNREACHED, PROPOSED]);
    expect(wanting).toHaveLength(section.outstanding);
    expect(section.entries.filter((d) => !isDeferralOutstanding(d))).toEqual([ANSWERED]);
  });
});

describe("the proposal an approve card is drawn over", () => {
  it("turns a refused reading into the proposal #180's card approves", () => {
    const proposal = proposalFor(PROPOSED);

    expect(proposal).not.toBeNull();
    expect(proposal!.outcome).toBe("proposed");
    expect(proposal!.word).toBe("zorp");
    // The target is the Rhyme Key the add was aimed at, and the proposal's own
    // key is computed from the phonemes rather than taken from the record.
    expect(proposal!.target).toBe(DOCKED);
    expect(proposal!.key).toBe("AO R P");
    expect(proposal!.respelling).not.toBe("");
  });

  // "Failed verification" is exactly "does not reach the target", and the card
  // says so — that is what makes approving it the honest reading rather than a
  // pronunciation correction. It is recomputed here rather than inherited from
  // the reason.
  it("reports that the reading does not reach the key it was aimed at", () => {
    expect(proposalFor(PROPOSED)!.reaches).toBe(false);
  });

  // The engine reads this word not at all — that is why it went to an agent —
  // and an empty `current` is what leaves the approve card offering `replace`
  // alone, with no second pronunciation to join to.
  it("offers the card no existing reading to join to", () => {
    expect(proposalFor(PROPOSED)!.current).toEqual([]);
  });

  it("has no proposal for a word the agent was never reached about", () => {
    expect(proposalFor(UNREACHED)).toBeNull();
  });

  it("has no proposal for a deferral the engine has already answered", () => {
    expect(proposalFor(ANSWERED)).toBeNull();
  });
});
