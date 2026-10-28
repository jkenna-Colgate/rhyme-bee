/**
 * The Judge's landing step (#266): each row of ADR-0017's table, from a reply
 * written out by hand the way a model sends it, through the classification, to
 * what lands. Nothing here calls a model or writes a file.
 */

import { describe, expect, it } from "vitest";
import { parseCmudict } from "../cmudict.ts";
import { classifyRuling, judgeQuestion, parseRhymeReply, parseWordhoodReply, type WordFacts } from "../judge.ts";
import {
  JUDGE_SECTION,
  land,
  parseRulingRecords,
  planJudging,
  serialiseRulingRecord,
  supplementAppend,
  type RuledCandidate,
} from "../judgeLanding.ts";
import type { RhymeKey } from "../phonology.ts";
import { parseUnconfirmedRhymes, serialiseUnconfirmedRhyme } from "../unconfirmedRhymes.ts";

const ctx = { date: "2026-10-28", model: "claude-sonnet-5-5", scheduledSeeds: new Set(["trick", "lunatic"]) };

const noReading: WordFacts = { isWord: true, readings: [] };
const holds = (...readings: string[]): WordFacts => ({ isWord: true, readings: readings.map((r) => r.split(" ")) });

const rhymeReply = (word: string, verdict: string, reading: string | null, confidence: string) =>
  `Here are the rulings.\n${JSON.stringify([{ word, verdict, reading, confidence, why: "stubbed" }])}`;
const wordhoodReply = (word: string, verdict: string, confidence = "high") =>
  JSON.stringify([{ word, verdict, confidence, why: "stubbed" }]);

/**
 * One Candidate through the Judge's leg as `runJudge` runs it: the question,
 * the rhyme reply, and the wordhood reply only for a ruling that would act.
 */
function judged(word: string, seedWord: string, rhymeKey: RhymeKey, facts: WordFacts, rhyme: string, wordhood?: string): RuledCandidate {
  const question = judgeQuestion(facts, rhymeKey);
  if (!("ask" in question)) throw new Error(`${word} is not sent: ${question.setAside}`);
  const [ruling] = parseRhymeReply(rhyme, 1);
  const first = classifyRuling(question.ask, ruling!, rhymeKey);
  if (!first.needsWordhood) return { word, seedWord, rhymeKey, ruling: ruling!, classification: first };
  if (wordhood === undefined) throw new Error(`${word} would act, so the test must stub the wordhood reply`);
  const [w] = parseWordhoodReply(wordhood, [word]);
  return { word, seedWord, rhymeKey, ruling: ruling!, wordhood: w, classification: classifyRuling(question.ask, ruling!, rhymeKey, w) };
}

describe("what a ruling lands as", () => {
  it("writes a reading for a Missing Reading ruled a Rhyme at high confidence that reaches the key and is a word", () => {
    const c = judged("grates", "plates", "EY T S", noReading, rhymeReply("grates", "rhyme", "g r ey1 t s", "high"), wordhoodReply("grates", "word"));
    const out = land([c], ctx);

    expect(out.readings).toEqual([{ word: "grates", phonemes: ["G", "R", "EY1", "T", "S"], note: expect.stringContaining("claude-sonnet-5-5") }]);
    expect(out.unconfirmedRhymes).toEqual([]);
    expect(out.records).toMatchObject([{ word: "grates", rhymeKey: "EY T S", knew: "missing-reading", confidence: "high", landed: "reading", wordhood: { verdict: "word" } }]);
  });

  it("lists an Unconfirmed Rhyme for a Missing Reading at medium confidence", () => {
    const c = judged("grates", "plates", "EY T S", noReading, rhymeReply("grates", "rhyme", "G R EY1 T S", "medium"), wordhoodReply("grates", "word"));
    const out = land([c], ctx);

    expect(out.readings).toEqual([]);
    expect(out.unconfirmedRhymes).toEqual([{ word: "grates", rhymeKey: "EY T S", writer: "judge:claude-sonnet-5-5", ruling: "missing-reading", confidence: "medium" }]);
    expect(out.records[0]!.landed).toBe("unconfirmed-rhyme");
  });

  it("lists an Unconfirmed Rhyme for an Overrule at high confidence, and never writes a reading", () => {
    const c = judged("clique", "week", "IY K", holds("K L IH1 K"), rhymeReply("clique", "rhyme", "K L IY1 K", "high"), wordhoodReply("clique", "word"));
    const out = land([c], ctx);

    expect(out.readings).toEqual([]);
    expect(out.unconfirmedRhymes).toEqual([{ word: "clique", rhymeKey: "IY K", writer: "judge:claude-sonnet-5-5", ruling: "overrule", confidence: "high" }]);
  });

  it("writes nothing for anything else, records the ruling, and asks no wordhood question", () => {
    const cases = [
      // A Missing Reading whose reading misses the key.
      judged("grates", "plates", "EY T S", noReading, rhymeReply("grates", "rhyme", "G R AE1 T S", "high")),
      // A Missing Reading at low confidence.
      judged("grates", "plates", "EY T S", noReading, rhymeReply("grates", "rhyme", "G R EY1 T S", "low")),
      // An Overrule at medium confidence.
      judged("clique", "week", "IY K", holds("K L IH1 K"), rhymeReply("clique", "rhyme", "K L IY1 K", "medium")),
      // A non-rhyme.
      judged("magic", "trick", "IH K", holds("M AE1 JH IH0 K"), rhymeReply("magic", "no-rhyme", null, "high")),
    ];
    for (const c of cases) {
      const out = land([c], ctx);
      expect(c.wordhood).toBeUndefined();
      expect([out.readings, out.unconfirmedRhymes]).toEqual([[], []]);
      expect(out.records.map((r) => r.landed)).toEqual(["nothing"]);
    }
  });

  it("holds back a name or a non-word as a suggested Demotion, at any confidence, and writes only its record", () => {
    for (const [verdict, confidence] of [["name", "low"], ["not-a-word", "high"]] as const) {
      const c = judged("grates", "plates", "EY T S", noReading, rhymeReply("grates", "rhyme", "G R EY1 T S", "high"), wordhoodReply("grates", verdict, confidence));
      const out = land([c], ctx);

      expect([out.readings, out.unconfirmedRhymes]).toEqual([[], []]);
      expect(out.records).toMatchObject([{ landed: "suggested-demotion", wordhood: { verdict, confidence } }]);
    }
  });

  it("never lists a scheduled Seed Word as an Unconfirmed Rhyme, and says why it wrote nothing", () => {
    const c = judged("lunatic", "brick", "IH K", holds("L UW1 N AH0 T IH0 K"), rhymeReply("lunatic", "rhyme", "L UW1 N AH0 T IH2 K", "high"), wordhoodReply("lunatic", "word"));
    const out = land([c], ctx);

    expect(out.unconfirmedRhymes).toEqual([]);
    expect(out.records).toMatchObject([{ landed: "nothing", heldBack: "scheduled-seed-word" }]);
  });

  it("judges a heretic-shape Candidate, and lands it at most as an Unconfirmed Rhyme", () => {
    const c = judged("heretic", "brick", "IH K", holds("HH EH1 R AH0 D AH0 K"), rhymeReply("heretic", "rhyme", "HH EH1 R AH0 T IH2 K", "high"), wordhoodReply("heretic", "word"));
    const out = land([c], ctx);

    expect(c.classification!.knew).toBe("overrule");
    expect(out.readings).toEqual([]);
    expect(out.unconfirmedRhymes).toMatchObject([{ word: "heretic", rhymeKey: "IH K", ruling: "overrule" }]);
  });

  it("does not record a reply it could not read, so the Candidate is sent again", () => {
    const unread = judged("grates", "plates", "EY T S", noReading, "I am not sure.");
    const noWordhood = judged("grates", "plates", "EY T S", noReading, rhymeReply("grates", "rhyme", "G R EY1 T S", "high"), "no");

    expect(land([unread, noWordhood], ctx).records).toEqual([]);
  });

  it("refuses to land a ruling that would act when the wordhood question was not asked", () => {
    const [ruling] = parseRhymeReply(rhymeReply("grates", "rhyme", "G R EY1 T S", "high"), 1);
    const c = { word: "grates", seedWord: "plates", rhymeKey: "EY T S", ruling: ruling!, classification: classifyRuling("missing-reading", ruling!, "EY T S") };

    expect(() => land([c], ctx)).toThrow(/wordhood/);
  });
});

describe("once per Candidate", () => {
  const candidates = [
    { word: "grates", seedWord: "plates", rhymeKey: "EY T S" },
    { word: "clique", seedWord: "week", rhymeKey: "IY K" },
  ];

  it("does not send a ruled Candidate on a second run, whatever it landed", () => {
    const first = land(
      [
        judged("grates", "plates", "EY T S", noReading, rhymeReply("grates", "rhyme", "G R EY1 T S", "medium"), wordhoodReply("grates", "word")),
        judged("clique", "week", "IY K", holds("K L IH1 K"), rhymeReply("clique", "no-rhyme", null, "high")),
      ],
      ctx,
    );
    const { records } = parseRulingRecords(first.records.map(serialiseRulingRecord).join(""));

    const second = planJudging(candidates, records);
    expect(second.send).toEqual([]);
    expect(second.ruledBefore.map((r) => [r.candidate.word, r.record.landed])).toEqual([["grates", "unconfirmed-rhyme"], ["clique", "nothing"]]);
  });

  it("knows a pair by its word and its Rhyme Key, not by the Seed Word it was typed for", () => {
    const { records } = parseRulingRecords(serialiseRulingRecord({
      date: "2026-10-28", word: "grates", rhymeKey: "EY T S", seedWord: "plates", model: "claude-sonnet-5-5",
      knew: "missing-reading", verdict: "no-rhyme", reading: null, confidence: "high", why: "", landed: "nothing",
    }));
    const plan = planJudging(
      [
        { word: "Grates", seedWord: "crates", rhymeKey: "EY T S" },
        { word: "grates", seedWord: "great", rhymeKey: "EY T" },
        { word: "grates", seedWord: "gate", rhymeKey: "EY T" },
      ],
      records,
    );

    expect(plan.send.map((c) => `${c.word} ${c.rhymeKey}`)).toEqual(["grates EY T"]);
    expect(plan.ruledBefore.map((r) => r.candidate.seedWord)).toEqual(["crates"]);
  });

  it("drops a record line that does not read, and names it", () => {
    const { records, malformed } = parseRulingRecords('not json\n{"word":"grates"}\n\n');
    expect([records, malformed]).toEqual([[], ["not json", '{"word":"grates"}']]);
  });
});

describe("the files it writes", () => {
  const readings = [
    { word: "grates", phonemes: ["G", "R", "EY1", "T", "S"], note: "# grates (#266): a note." },
    { word: "slates", phonemes: ["S", "L", "EY1", "T", "S"], note: "# slates (#266): a note." },
  ];

  it("appends the Judge's readings under one section, written once, that the supplement reads back", () => {
    const once = "# header\nviceroy V AY1 S R OY2\n";
    const first = supplementAppend(once, readings.slice(0, 1));
    const twice = once + first + supplementAppend(once + first, readings.slice(1));

    expect(twice.split(JUDGE_SECTION).length).toBe(2);
    expect(parseCmudict(twice).get("slates")).toEqual([["S", "L", "EY1", "T", "S"]]);
    expect(parseCmudict(twice).get("grates")).toEqual([["G", "R", "EY1", "T", "S"]]);
    expect(supplementAppend(once, [])).toBe("");
  });

  it("writes an Unconfirmed Rhyme the list reads back", () => {
    const c = judged("clique", "week", "IY K", holds("K L IH1 K"), rhymeReply("clique", "rhyme", "K L IY1 K", "high"), wordhoodReply("clique", "word"));
    const text = land([c], ctx).unconfirmedRhymes.map(serialiseUnconfirmedRhyme).join("");

    expect(parseUnconfirmedRhymes(text)).toEqual({ entries: land([c], ctx).unconfirmedRhymes, malformed: [] });
  });
});
