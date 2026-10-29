/**
 * What the Editor's Pass shows of the Judge's work (#269): the sentence beside
 * a Candidate it ruled on, the suggested Demotion, the day's Unconfirmed
 * Rhymes, and the proposal a Confirm approves. The readout itself is
 * `scripts/__tests__/editorCandidates.test.ts`'s; this is what the browser
 * makes of it.
 */

import { describe, expect, it } from "vitest";
import type {
  CandidateQueueReadout,
  ReadCandidate,
  ReadUnconfirmedRhyme,
} from "../../scripts/editorCandidates.ts";
import type { JudgeRulingRecord } from "../../src/judgeLanding.ts";
import type { SupplementCandidate } from "../../src/supplementCandidate.ts";
import { cardFor, evidenceFor, suggestedDemotion, unconfirmedForDay } from "../src/editor/dayCandidates.ts";
import { confirmGesture, confirmProposal, judgeRulingSentence } from "../src/editor/judgeRuling.ts";

const record = (over: Partial<JudgeRulingRecord> = {}): JudgeRulingRecord => ({
  date: "2026-10-28",
  word: "clique",
  rhymeKey: "IY K",
  seedWord: "week",
  model: "claude-sonnet-5-5",
  knew: "overrule",
  verdict: "rhyme",
  reading: "K L IY1 K",
  confidence: "high",
  why: "Said to rhyme with week.",
  landed: "unconfirmed-rhyme",
  ...over,
});

const CAPTURED: SupplementCandidate = {
  word: "clique",
  seedWord: "week",
  seedRhymeKey: "IY K",
  reason: "does-not-rhyme",
  engineRespelling: null,
  timestamp: "2026-10-28T12:00:00.000Z",
};

const listed = (word: string, rhymeKey: string, over: Partial<ReadUnconfirmedRhyme> = {}): ReadUnconfirmedRhyme => ({
  line: { word, rhymeKey, writer: "judge:claude-sonnet-5-5", ruling: "overrule", confidence: "high" },
  judged: record({ word, rhymeKey }),
  readings: [{ phonemes: ["K", "L", "IH1", "K"], key: "IH K" }],
  proposal: { phonemes: ["K", "L", "IY1", "K"], key: "IY K", reaches: true },
  ...over,
});

describe("the Judge's ruling beside a Candidate", () => {
  it("says what it heard, how sure it was, what the game knew and what landed", () => {
    const said = judgeRulingSentence(record());

    expect(said).toContain("The Judge (claude-sonnet-5-5, 2026-10-28) judged it a Rhyme, hearing K L IY1 K at high confidence");
    expect(said).toContain("an Overrule");
    expect(said).toContain("Unconfirmed Rhyme");
  });

  it("says a refusal, and that the Candidate waits for the editor", () => {
    const said = judgeRulingSentence(record({ verdict: "no-rhyme", reading: null, knew: "missing-reading", landed: "nothing" }));

    expect(said).toContain("judged it no Rhyme at high confidence, on a Missing Reading");
    expect(said).toContain("waits for your ruling");
  });

  it("gives the wordhood answer behind a suggested Demotion", () => {
    const said = judgeRulingSentence(record({ landed: "suggested-demotion", wordhood: { verdict: "name", confidence: "medium", why: "" } }));

    expect(said).toContain("it said a name (medium confidence)");
    expect(said).toContain("suggests a Demotion");
  });

  it("says why a scheduled Seed Word was not listed", () => {
    expect(judgeRulingSentence(record({ landed: "nothing", heldBack: "scheduled-seed-word" }))).toContain("scheduled Seed Word");
  });
});

describe("a suggested Demotion", () => {
  const suggested: ReadCandidate = { word: "clique", candidate: CAPTURED, judged: record(), state: "suggested-demotion", reason: "proper-noun" };

  it("draws its own card, with no reading to weigh", () => {
    expect(cardFor(suggested)).toBe("suggested-demotion");
    expect(evidenceFor(suggested)).toEqual({ readings: [], relatives: [], composed: null });
  });

  it("marks the Demotion the Judge's answer points at, and nothing on any other Candidate", () => {
    expect(suggestedDemotion(suggested)).toBe("proper-noun");
    expect(suggestedDemotion({ word: "clique", candidate: CAPTURED, judged: record(), state: "is-a-name" })).toBeNull();
  });
});

describe("the day's Unconfirmed Rhymes", () => {
  const queue = {
    groups: [],
    unconfirmedRhymes: [listed("clique", "IY K"), listed("clique", "IH K"), listed("pique", "IY K")],
  } as unknown as CandidateQueueReadout;

  it("are the standing lines on the day's own Rhyme Key", () => {
    expect(unconfirmedForDay(queue, "IY K").map((u) => u.line.word)).toEqual(["clique", "pique"]);
    expect(unconfirmedForDay(null, "IY K")).toEqual([]);
  });

  it("offer the Judge's reading to confirm, beside the engine's own, aimed at the line's key", () => {
    const proposal = confirmProposal(listed("clique", "IY K"));

    expect(proposal).toMatchObject({
      outcome: "proposed",
      word: "clique",
      target: "IY K",
      current: [{ phonemes: ["K", "L", "IH1", "K"], key: "IH K" }],
      phonemes: ["K", "L", "IY1", "K"],
      key: "IY K",
      reaches: true,
    });
    expect(proposal!.respelling).not.toBe("");
  });

  it("offer nothing to confirm when there is no reading, so the editor asks an agent", () => {
    expect(confirmProposal(listed("clique", "IY K", { judged: null, proposal: null }))).toBeNull();
  });
});

/**
 * Which gesture confirms a line. The correction route answers
 * `nothing-to-correct` for a word with no reading without asking anyone, so a
 * Missing Reading with nothing proposed would be stuck on an ask; its confirm
 * is the add instead.
 */
describe("how an Unconfirmed Rhyme is confirmed", () => {
  it("approves the Judge's reading when there is one, whatever the engine reads", () => {
    expect(confirmGesture(listed("clique", "IY K"))).toBe("approve");
    expect(confirmGesture(listed("clique", "IY K", { readings: [] }))).toBe("approve");
  });

  it("asks an agent for a correction on an Overrule with nothing proposed", () => {
    expect(confirmGesture(listed("clique", "IY K", { judged: null, proposal: null }))).toBe("ask");
  });

  it("queues an add for a Missing Reading with nothing proposed", () => {
    expect(confirmGesture(listed("clique", "IY K", { judged: null, readings: [], proposal: null }))).toBe("add");
  });
});

/**
 * A Candidate on a listed pair reads `unconfirmed-rhyme` and carries the line,
 * so the pair is drawn on the Candidate's card and left off the day's list.
 */
describe("a Candidate on a listed pair", () => {
  const line = listed("clique", "IY K");
  const appealed: ReadCandidate = { word: "clique", candidate: CAPTURED, judged: record(), state: "unconfirmed-rhyme", listed: line };
  const queue = {
    unconfirmedRhymes: [line, listed("pique", "IY K"), listed("clique", "IH K")],
    groups: [{ rhymeKey: "IY K", day: null, seedWords: ["week"], candidates: [appealed], outstanding: 1 }],
  } as unknown as CandidateQueueReadout;

  it("draws the line's own card, weighed against the engine's reading", () => {
    expect(cardFor(appealed)).toBe("unconfirmed");
    expect(evidenceFor(appealed)).toEqual({ readings: line.readings, relatives: [], composed: null });
  });

  it("is left off the day's Unconfirmed Rhymes, and a listed pair with no Candidate is not", () => {
    expect(unconfirmedForDay(queue, "IY K").map((u) => u.line.word)).toEqual(["pique"]);
    expect(unconfirmedForDay(queue, "IH K").map((u) => u.line.word)).toEqual(["clique"]);
  });
});
