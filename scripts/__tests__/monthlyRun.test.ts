import { describe, expect, it } from "vitest";
import type { JudgeQuestion } from "../../src/judge.ts";
import type { JudgeRulingRecord } from "../../src/judgeLanding.ts";
import type { SupplementCandidate } from "../../src/supplementCandidate.ts";
import { continuityLinesIn, monthlyReport, planAppeals, type AppealsPart } from "../monthlyRun.ts";

const TRICK = "IH K";

function appeal(word: string, timestamp: string, over: Partial<SupplementCandidate> = {}): SupplementCandidate {
  return {
    word,
    seedWord: "trick",
    seedRhymeKey: TRICK,
    reason: "not-a-known-word",
    engineRespelling: null,
    timestamp,
    ...over,
  };
}

/** Every word is a Missing Reading unless it is named here. */
function asker(setAside: Record<string, "already-rhymes" | "not-on-word-list"> = {}) {
  return (word: string): JudgeQuestion => (setAside[word] ? { setAside: setAside[word]! } : { ask: "missing-reading" });
}

const index = { question: asker(), seedKeys: () => [TRICK] };

function ruled(word: string, rhymeKey = TRICK): JudgeRulingRecord {
  return {
    date: "2026-10-01", word, rhymeKey, seedWord: "trick", model: "claude-sonnet-5-5",
    knew: "missing-reading", verdict: "rhyme", reading: null, confidence: "high", why: "", landed: "reading",
  };
}

const words = (items: readonly { word: string }[]) => items.map((i) => i.word);

describe("planAppeals", () => {
  it("sends no more Candidates than the limit, oldest Appeal first, and leaves the rest waiting", () => {
    const queue = [
      appeal("schtick", "2026-10-03T00:00:00Z"),
      appeal("klick", "2026-10-01T00:00:00Z"),
      appeal("brick-a-brac", "2026-10-02T00:00:00Z"),
    ];
    const plan = planAppeals(queue, { ...index, rulings: [], declines: [], limit: 2 });

    expect(words(plan.send)).toEqual(["klick", "brick-a-brac"]);
    expect(words(plan.waiting)).toEqual(["schtick"]);
  });

  it("never sends a Candidate twice: not one ruled on before, not one Declined, not two Appeals of one pair", () => {
    const queue = [
      appeal("klick", "2026-10-01T00:00:00Z"),
      appeal("Klick", "2026-10-02T00:00:00Z", { reason: "does-not-rhyme" }),
      appeal("schtick", "2026-10-03T00:00:00Z"),
      appeal("clique", "2026-10-04T00:00:00Z"),
      appeal("zick", "2026-10-05T00:00:00Z"),
    ];
    const plan = planAppeals(queue, {
      ...index,
      rulings: [ruled("schtick")],
      declines: [{ word: "clique", rhymeKey: TRICK }],
      limit: 10,
    });

    expect(words(plan.send)).toEqual(["klick", "zick"]);
    expect(words(plan.ruledBefore.map((r) => r.item))).toEqual(["schtick"]);
    expect(words(plan.declined)).toEqual(["clique"]);
  });

  it("sends next run what the limit held back, and nothing the last run ruled on", () => {
    const queue = ["a", "b", "c", "d", "e"].map((w, i) => appeal(`${w}ick`, `2026-10-0${i + 1}T00:00:00Z`));
    const first = planAppeals(queue, { ...index, rulings: [], declines: [], limit: 2 });
    const second = planAppeals(queue, { ...index, rulings: first.send.map((i) => ruled(i.word)), declines: [], limit: 2 });

    expect(words(first.send)).toEqual(["aick", "bick"]);
    expect(words(second.send)).toEqual(["cick", "dick"]);
    expect(words(second.waiting)).toEqual(["eick"]);
  });

  it("does not count against the limit what it would not send", () => {
    const queue = [
      appeal("tick", "2026-10-01T00:00:00Z"),
      appeal("xqzk", "2026-10-02T00:00:00Z"),
      appeal("klick", "2026-10-03T00:00:00Z"),
    ];
    const plan = planAppeals(queue, {
      ...index,
      question: asker({ tick: "already-rhymes", xqzk: "not-on-word-list" }),
      rulings: [],
      declines: [],
      limit: 1,
    });

    expect(words(plan.send)).toEqual(["klick"]);
    expect(words(plan.setAside)).toEqual(["tick", "xqzk"]);
    expect(plan.waiting).toEqual([]);
  });

  it("sends nothing raised on a Rhyme Key its Seed Word no longer reads on", () => {
    const queue = [appeal("storming", "2026-10-01T00:00:00Z", { seedWord: "storm", seedRhymeKey: "AO R M" })];
    const plan = planAppeals(queue, { ...index, seedKeys: () => ["AO1 R M"], rulings: [], declines: [], limit: 5 });

    expect(plan.send).toEqual([]);
    expect(words(plan.keyGone)).toEqual(["storming"]);
  });
});

const BUILD_LOG = [
  "Wrote dist-data/index-0123abcd.json (manifest: manifest.json).",
  "Unconfirmed Rhymes: 3 standing.",
  "Continuity: 260 scheduled days, 1 failed to pin; 1 repaired, 0 Free Play.",
  "  repaired 2026-11-20 by step 1: storm on AO R M -> storm on AO1 R M (figures unchanged)",
  "  one-place: Rhyme Key IY D ER holds 2 places: 2026-08-08 (centimeter), 2026-08-29 (cheerleader)",
  "Unconfirmed Rhymes: 2026-12-01's Seed Word \"clique\" is listed for IH K; a Seed Word must not be one.",
  "",
].join("\n");

const TIER_MOVES_LOG = [
  "Session Records: 40 read, 40 replayed.",
  "Settings (unclaimed placeholders): share 0.3, Reachability floor 0.1, fewest Sessions a day 10.",
  "Moved to Answer: 1.",
  "  objurgate: 14 of 40 Sessions, lower bound 0.211",
  "No day under the Reachability floor.",
  "Appended to data/tier-moves.csv. Rebuild the index to ship the moves.",
  "",
].join("\n");

const APPEALS_PART: AppealsPart = {
  date: "2026-11-01",
  model: "claude-sonnet-5-5",
  run: 1,
  limit: 40,
  answeredBy: ["claude-sonnet-5-5"],
  calls: { rhyme: 1, wordhood: 1, fromCache: 0 },
  candidatesJudged: 2,
  landed: { reading: 1, nothing: 1 },
  writes: {
    readings: [{ word: "schtick", reading: "SH T IH1 K" }],
    unconfirmedRhymes: [],
    suggestedDemotions: [],
  },
  rulings: [{ word: "schtick" }, { word: "zick" }],
  waiting: [{ word: "klick", seedWord: "trick", rhymeKey: TRICK }],
  setAside: [],
  ruledBefore: [],
  declined: [],
  keyGone: [],
};

describe("continuityLinesIn", () => {
  it("takes the Continuity lines out of a build's output, and nothing else", () => {
    expect(continuityLinesIn(BUILD_LOG)).toEqual([
      "Continuity: 260 scheduled days, 1 failed to pin; 1 repaired, 0 Free Play.",
      "  repaired 2026-11-20 by step 1: storm on AO R M -> storm on AO1 R M (figures unchanged)",
      "  one-place: Rhyme Key IY D ER holds 2 places: 2026-08-08 (centimeter), 2026-08-29 (cheerleader)",
    ]);
  });
});

describe("monthlyReport", () => {
  const base = { date: "2026-11-01", run: 1, model: "claude-sonnet-5-5", tierMovesLog: TIER_MOVES_LOG, buildLog: BUILD_LOG };

  it("says the date, the Appeals judged, the rulings written, the model, the Tier moves and the Continuity lines", () => {
    const { report, subject } = monthlyReport({ ...base, appealsStep: "success", appeals: APPEALS_PART });

    expect(report).toMatchObject({
      date: "2026-11-01",
      command: "monthly",
      run: 1,
      model: "claude-sonnet-5-5",
      answeredBy: ["claude-sonnet-5-5"],
      candidatesJudged: 2,
      landed: { reading: 1, nothing: 1 },
      writes: { readings: [{ word: "schtick", reading: "SH T IH1 K" }] },
      appeals: { step: "success", limit: 40, waiting: [{ word: "klick" }] },
      rulings: [{ word: "schtick" }, { word: "zick" }],
      tierMoves: TIER_MOVES_LOG.trimEnd().split("\n"),
      continuity: [
        "Continuity: 260 scheduled days, 1 failed to pin; 1 repaired, 0 Free Play.",
        "  repaired 2026-11-20 by step 1: storm on AO R M -> storm on AO1 R M (figures unchanged)",
        "  one-place: Rhyme Key IY D ER holds 2 places: 2026-08-08 (centimeter), 2026-08-29 (cheerleader)",
      ],
    });
    expect(subject).toBe("Monthly run 2026-11-01: 2 Appeals judged, 1 Tier move, 1 day repaired");
  });

  it("still reports the Tier moves and Continuity when the Appeals step failed, and says nothing was judged", () => {
    const { report, subject } = monthlyReport({ ...base, appealsStep: "failure", appeals: null });

    expect(report).toMatchObject({
      model: "claude-sonnet-5-5",
      answeredBy: [],
      candidatesJudged: 0,
      landed: {},
      writes: { readings: [], unconfirmedRhymes: [], suggestedDemotions: [] },
      appeals: { step: "failure" },
      tierMoves: TIER_MOVES_LOG.trimEnd().split("\n"),
    });
    expect((report as { note: string }).note).toMatch(/Appeals step failed/);
    expect(subject).toBe("Monthly run 2026-11-01: the Appeals step failed, 1 Tier move, 1 day repaired");
  });
});
