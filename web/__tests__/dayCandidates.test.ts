/**
 * The day panel's selection, and the card each state picks. Both are pure, both
 * are the browser's, and both are tested over object literals — the shape
 * `retier.test.ts` and `correctedDay.test.ts` established for the editor's
 * browser-side modules.
 *
 * What is *not* tested here is any state derivation: every state on these
 * fixtures arrives already decided, because that is how it arrives on the
 * screen. A test that recomputed one would be testing a second implementation
 * this slice deliberately does not have.
 */

import { describe, expect, it } from "vitest";
import type {
  CandidateQueueReadout,
  ReadCandidate,
} from "../../scripts/editorCandidates.ts";
import type { SupplementCandidate } from "../../src/supplementCandidate.ts";
import { candidatesForDay, cardFor, evidenceFor } from "../src/editor/dayCandidates.ts";

const DOCKED = "AA K T";
const ATE = "EY T";

function jot(word: string, seedWord: string, seedRhymeKey: string): SupplementCandidate {
  return {
    word,
    seedWord,
    seedRhymeKey,
    reason: "does-not-rhyme",
    engineRespelling: null,
    timestamp: "2026-08-01T12:00:00.000Z",
  };
}

/** One Candidate in a named state, with the evidence that state carries. */
function read(word: string, seedWord: string, key: string, state: ReadCandidate["state"]): ReadCandidate {
  const identity = { word, candidate: jot(word, seedWord, key) };
  switch (state) {
    case "resolved":
      return { ...identity, state, readings: [{ phonemes: ["T", "AA1", "K", "T"], key }] };
    case "declined":
      return { ...identity, state };
    case "is-a-name":
      return { ...identity, state };
    case "needs-correction":
      return { ...identity, state, readings: [{ phonemes: ["EY1", "T"], key: ATE }] };
    case "addable":
      return { ...identity, state, readings: [], relatives: [], composed: null };
  }
}

const QUEUE: CandidateQueueReadout = {
  total: 4,
  outstanding: 2,
  newest: "2026-08-07T18:30:00.000Z",
  groups: [
    {
      rhymeKey: DOCKED,
      day: { date: "2026-09-02", weekday: "Wed", week: 1, seed: "shellshocked" },
      seedWords: ["docked", "shellshocked"],
      outstanding: 2,
      candidates: [
        read("talked", "docked", DOCKED, "resolved"),
        read("undocked", "docked", DOCKED, "addable"),
        read("chocolate", "shellshocked", DOCKED, "needs-correction"),
      ],
    },
    {
      rhymeKey: ATE,
      day: { date: "2026-09-01", weekday: "Tue", week: 1, seed: "ate" },
      seedWords: ["ate"],
      outstanding: 0,
      candidates: [read("kate", "ate", ATE, "declined")],
    },
  ],
};

describe("the day panel's selection", () => {
  it("takes the group whose Rhyme Key is the day's", () => {
    const day = candidatesForDay(QUEUE, DOCKED);

    expect(day.rhymeKey).toBe(DOCKED);
    expect(day.all.map((c) => c.word)).toEqual(["talked", "undocked", "chocolate"]);
  });

  it("separates out the ones that still want a ruling", () => {
    expect(candidatesForDay(QUEUE, DOCKED).outstanding.map((c) => c.word)).toEqual([
      "undocked",
      "chocolate",
    ]);
    // Every Candidate on this key has been settled — the panel shows the group
    // and nothing outstanding, rather than showing nothing at all.
    const settled = candidatesForDay(QUEUE, ATE);
    expect(settled.all.map((c) => c.word)).toEqual(["kate"]);
    expect(settled.outstanding).toEqual([]);
  });

  it("names every Seed Word the group's Candidates were raised against", () => {
    expect(candidatesForDay(QUEUE, DOCKED).seedWords).toEqual(["docked", "shellshocked"]);
  });

  it("answers a key the queue holds nothing for with an empty selection", () => {
    expect(candidatesForDay(QUEUE, "OY")).toEqual({
      rhymeKey: "OY",
      all: [],
      outstanding: [],
      seedWords: [],
    });
  });

  it("answers a queue that has not loaded the same way, rather than throwing", () => {
    expect(candidatesForDay(null, DOCKED)).toEqual({
      rhymeKey: DOCKED,
      all: [],
      outstanding: [],
      seedWords: [],
    });
  });
});

describe("the card a state selects", () => {
  it("settles a resolved or declined Candidate", () => {
    expect(cardFor(read("talked", "docked", DOCKED, "resolved"))).toBe("settled");
    expect(cardFor(read("kate", "ate", ATE, "declined"))).toBe("settled");
  });

  it("gives a name its own card", () => {
    expect(cardFor(read("kate", "ate", ATE, "is-a-name"))).toBe("name");
  });

  it("shows the correction card for a word the engine reads elsewhere", () => {
    const candidate = read("chocolate", "docked", DOCKED, "needs-correction");
    expect(cardFor(candidate)).toBe("correction");
    // The evidence the correction card turns on, and nothing else: a word that
    // already reads is never offered relatives (`gatherEvidence`).
    expect(candidate.state === "needs-correction" && candidate.readings).toHaveLength(1);
  });

  it("shows the plain add card for a word with no evidence to derive from", () => {
    expect(cardFor(read("grates", "ate", ATE, "addable"))).toBe("add");
  });

  it("shows the derivation card when there are relatives, and no direct reading with them", () => {
    const base = read("overjoy", "joy", "OY", "addable");
    if (base.state !== "addable") throw new Error("expected an addable Candidate");
    const candidate: ReadCandidate = {
      ...base,
      relatives: [
        { word: "overjoyed", readings: [{ phonemes: ["OW2", "V", "ER0", "JH", "OY1", "D"], key: "OY D" }], rhymes: false },
      ],
    };

    expect(cardFor(candidate)).toBe("derivation");
    expect(candidate.state === "addable" && candidate.readings).toEqual([]);
  });

  it("shows the derivation card for a composed reading too", () => {
    const base = read("ballwalked", "docked", DOCKED, "addable");
    if (base.state !== "addable") throw new Error("expected an addable Candidate");
    const candidate: ReadCandidate = {
      ...base,
      composed: {
        phonemes: ["B", "AA1", "L", "W", "AA2", "K", "T"],
        key: DOCKED,
        head: { word: "ball", phonemes: ["B", "AA1", "L"] },
        tail: { word: "walked", phonemes: ["W", "AA1", "K", "T"] },
      },
    };

    expect(cardFor(candidate)).toBe("derivation");
  });
});

/**
 * The rule #180 states about the screen, held to account away from the screen: a
 * correction card shows direct readings and no relatives, and a derivation card
 * shows relatives and no direct reading. It is `evidenceFor`'s and not
 * `CandidateQueueView`'s precisely so this file can ask it.
 *
 * Both directions are asserted over a Candidate carrying **both** kinds of
 * evidence, which is the only way the assertion is not vacuous: a real
 * `needs-correction` Candidate has no relatives because `gatherEvidence` never
 * searches for them, so a fixture that also had none would pass with the
 * selection deleted. The rule under test is that the card drops what its own
 * case does not turn on, whatever it was handed.
 */
describe("the evidence a card shows", () => {
  const READING = { phonemes: ["CH", "AO1", "K", "L", "AH0", "T"], key: "AH T" };
  const RELATIVE = {
    word: "overjoyed",
    readings: [{ phonemes: ["OW2", "V", "ER0", "JH", "OY1", "D"], key: "OY D" }],
    rhymes: false,
  };
  const COMPOSED = {
    phonemes: ["B", "AA1", "L", "W", "AA2", "K", "T"],
    key: DOCKED,
    head: { word: "ball", phonemes: ["B", "AA1", "L"] },
    tail: { word: "walked", phonemes: ["W", "AA1", "K", "T"] },
  };

  it("shows a correction card the direct readings and no relatives", () => {
    const base = read("chocolate", "docked", DOCKED, "needs-correction");
    if (base.state !== "needs-correction") throw new Error("expected a correction");
    const candidate: ReadCandidate = { ...base, readings: [READING] };

    expect(cardFor(candidate)).toBe("correction");
    expect(evidenceFor(candidate)).toEqual({
      readings: [READING],
      relatives: [],
      composed: null,
    });
  });

  it("shows a derivation card the relatives and no direct reading", () => {
    const base = read("overjoy", "joy", "OY", "addable");
    if (base.state !== "addable") throw new Error("expected an addable Candidate");
    // Handed a direct reading it has no business showing, so that dropping it is
    // something this test can see rather than something the fixture arranged.
    const candidate: ReadCandidate = {
      ...base,
      readings: [READING],
      relatives: [RELATIVE],
      composed: COMPOSED,
    };

    expect(cardFor(candidate)).toBe("derivation");
    expect(evidenceFor(candidate)).toEqual({
      readings: [],
      relatives: [RELATIVE],
      composed: COMPOSED,
    });
  });

  it("shows the plain add card its own reading, which is the no-wordhood case", () => {
    const base = read("grates", "ate", ATE, "addable");
    if (base.state !== "addable") throw new Error("expected an addable Candidate");
    const candidate: ReadCandidate = { ...base, readings: [READING] };

    expect(cardFor(candidate)).toBe("add");
    expect(evidenceFor(candidate)).toEqual({ readings: [READING], relatives: [], composed: null });
  });

  it("shows a settled or name card nothing — neither ruling is made from a reading", () => {
    const nothing = { readings: [], relatives: [], composed: null };
    expect(evidenceFor(read("kate", "ate", ATE, "declined"))).toEqual(nothing);
    expect(evidenceFor(read("kate", "ate", ATE, "is-a-name"))).toEqual(nothing);
  });

  it("shows a resolved Candidate the reading that resolved it", () => {
    const candidate = read("talked", "docked", DOCKED, "resolved");
    expect(evidenceFor(candidate).readings).toHaveLength(1);
    expect(evidenceFor(candidate).relatives).toEqual([]);
  });
});
