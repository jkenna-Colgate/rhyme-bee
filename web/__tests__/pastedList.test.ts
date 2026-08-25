/**
 * The join a pasted third-party rhyme list gets against the day (#188).
 *
 * Pure — text in, buckets out — so every case here is a literal input and a
 * literal expectation, with no browser, no network and no fixture server. That
 * is the shape `dayCandidates.test.ts`, `demote.test.ts` and `decline.test.ts`
 * established for the editor's browser-side modules, and this follows it.
 *
 * The tests assert on what the join returns and never on how it got there: the
 * parse, the dedupe and the set membership are the module's own business, and a
 * test that reached into one would be a second implementation of it.
 */

import { describe, expect, it } from "vitest";
import type { DayWord, ScheduledDayReadout } from "../../scripts/editorDay.ts";
import type { Pronunciation } from "../../src/phonology.ts";
import type { EvidenceReply, WordFacts } from "../src/editor/evidence.ts";
import type { AddOutcome, WordOutcome } from "../src/editor/addOutcome.ts";
import {
  joinPastedList,
  pileToAccept,
  refusedReadings,
  type WordWithoutReading,
} from "../src/editor/pastedList.ts";

const DATE = "2026-08-15";
const IDIOTIC = "AA T IH K";

/** `n` as lower-case letters, so a generated list holds no two of the same. */
function letters(n: number): string {
  return n
    .toString(26)
    .split("")
    .map((digit) => String.fromCharCode(97 + parseInt(digit, 26)))
    .join("");
}

function word(spelling: string, knownness: number | null = 0.5): DayWord {
  return { word: spelling, length: spelling.length, knownness };
}

/**
 * A day with the two lists the join reads and the rest of the payload filled in
 * plausibly. Only `answers` and `bonusWords` are ever varied: nothing else on a
 * readout is a fact about what the Puzzle covers.
 */
function day(answers: string[], bonusWords: string[] = []): ScheduledDayReadout {
  const facts = { answerCount: answers.length, maxScore: 100, difficulty: 0.4 };
  return {
    outcome: "day",
    date: DATE,
    weekday: "Sat",
    week: 3,
    seed: "idiotic",
    seedRespelling: "id-ee-OT-ik",
    rhymeKey: IDIOTIC,
    facts,
    drift: {
      date: DATE,
      weekday: "Sat",
      seed: "idiotic",
      rhymeKey: IDIOTIC,
      recorded: { answerCount: facts.answerCount, difficulty: facts.difficulty },
      recomputed: facts,
      weekdayBand: { weekday: "Sat", min: 0, max: 1 },
      sizeBand: { min: 1, max: 500 },
      drifted: false,
      reasons: [],
    },
    answers: answers.map((spelling) => word(spelling)),
    bonusWords: bonusWords.map((spelling) => word(spelling)),
  };
}

describe("joinPastedList", () => {
  it("drops a pasted word the day already serves as an Answer, and counts it", () => {
    const joined = joinPastedList("chaotic\nnecrotic", day(["chaotic"]));

    expect(joined.covered).toBe(1);
    expect(joined.residue).toEqual(["necrotic"]);
  });

  it("drops a pasted word the day already serves as a Bonus Word", () => {
    const joined = joinPastedList("zymotic\nnecrotic", day(["chaotic"], ["zymotic"]));

    expect(joined.covered).toBe(1);
    expect(joined.residue).toEqual(["necrotic"]);
  });

  it("counts the covered words rather than listing them", () => {
    const joined = joinPastedList("chaotic\nhypnotic\nnecrotic", day(["chaotic", "hypnotic"]));

    expect(joined).toEqual({ pasted: 3, covered: 2, residue: ["necrotic"], buckets: null });
  });

  it("keeps the residue in the order the pasted list gave it", () => {
    const joined = joinPastedList("necrotic\nbiotic\northotic", day(["chaotic"]));

    expect(joined.residue).toEqual(["necrotic", "biotic", "orthotic"]);
  });

  it("drops phrases, hyphenated entries and affix fragments silently", () => {
    const joined = joinPastedList(
      "necrotic\nhard hat\nsemi-chaotic\n-otic\notic-",
      day(["chaotic"]),
    );

    expect(joined).toEqual({ pasted: 1, covered: 0, residue: ["necrotic"], buckets: null });
  });

  it("drops malformed entries silently", () => {
    const joined = joinPastedList("necrotic\nb1otic\nchaotic¹\nx.y\n'", day([]));

    expect(joined).toEqual({ pasted: 1, covered: 0, residue: ["necrotic"], buckets: null });
  });

  it("absorbs surrounding whitespace, blank lines, casing and duplicates", () => {
    const joined = joinPastedList(
      "  Necrotic \n\n\nBIOTIC\n necrotic\nnecrotic  \n",
      day(["chaotic"]),
    );

    expect(joined).toEqual({
      pasted: 2,
      covered: 0,
      residue: ["necrotic", "biotic"],
      buckets: null,
    });
  });

  it("reads a comma-separated paste as entries, not as one phrase", () => {
    const joined = joinPastedList("chaotic, necrotic, hard hat", day(["chaotic"]));

    expect(joined).toEqual({ pasted: 2, covered: 1, residue: ["necrotic"], buckets: null });
  });

  it("returns empty buckets for an empty paste rather than failing", () => {
    const nothing = { pasted: 0, covered: 0, residue: [], buckets: null };

    expect(joinPastedList("", day(["chaotic"]))).toEqual(nothing);
    expect(joinPastedList("   \n\n", day(["chaotic"]))).toEqual(nothing);
  });

  it("accepts a paste of any size, with no cap in the tool", () => {
    // Five thousand *distinct* spellings, so nothing here is absorbed by the
    // dedupe and the count can only be shortened by a cap. There is none.
    const entries = Array.from({ length: 5000 }, (_, i) => `word${letters(i)}`);
    const joined = joinPastedList(entries.join("\n"), day(["chaotic"]));

    expect(joined.pasted).toBe(5000);
    expect(joined.residue).toHaveLength(5000);
  });

  it("drops a space-separated paste entire, rather than reading it as words", () => {
    // The cost of separating on newlines and commas but never on spaces, which
    // is what keeps `hard hat` detectable as a phrase. The panel is what tells
    // the editor this happened; the join just reports nothing found.
    const joined = joinPastedList("chaotic necrotic biotic", day(["chaotic"]));

    expect(joined).toEqual({ pasted: 0, covered: 0, residue: [], buckets: null });
  });

  it("joins to nothing when the readout is not a day", () => {
    const nothing = { pasted: 0, covered: 0, residue: [], buckets: null };

    expect(joinPastedList("necrotic\nbiotic", null)).toEqual(nothing);
    expect(
      joinPastedList("necrotic\nbiotic", {
        outcome: "not-scheduled",
        date: DATE,
        firstDate: "2026-08-01",
        lastDate: "2026-08-14",
      }),
    ).toEqual(nothing);
  });
});

/**
 * The facts the endpoint answers with, built by hand.
 *
 * This is the second adapter the evidence seam has, and the reason it is shaped
 * as evidence rather than as buckets: the whole of #189's rule is expressible as
 * a literal here, with no browser, no network and no fixture server, because
 * nothing in the join reads a file.
 *
 * The default is the residue's overwhelming case on the measured `idiotic`
 * day — a word with wordhood, no reading of its own and no split that reaches
 * the key — so each test below states only the fact it is about.
 */
function facts(word: string, over: Partial<WordFacts> = {}): WordFacts {
  return {
    word,
    target: IDIOTIC,
    isWord: true,
    isName: false,
    direct: [],
    rhymesDirectly: false,
    relatives: [],
    composed: null,
    knownness: 0.5,
    ...over,
  };
}

function evidence(words: WordFacts[], rhymeKey = IDIOTIC): EvidenceReply {
  return { rhymeKey, words };
}

/** A composed reading that landed on `key`, as `composeReading` would return it. */
function composed(phonemes: Pronunciation, key = IDIOTIC) {
  return {
    phonemes,
    key,
    head: { word: "robo", phonemes: ["R", "OW1", "B", "OW0"] as Pronunciation },
    tail: { word: "tic", phonemes: ["T", "IH1", "K"] as Pronunciation },
  };
}

describe("joinPastedList: the residue, split on wordhood", () => {
  it("has no buckets at all until evidence for the residue arrives", () => {
    const joined = joinPastedList("necrotic\nbiotic", day(["chaotic"]));

    expect(joined.residue).toEqual(["necrotic", "biotic"]);
    expect(joined.buckets).toBeNull();
  });

  it("puts a word with wordhood and no reading in the main pile", () => {
    const joined = joinPastedList(
      "necrotic",
      day(["chaotic"]),
      evidence([facts("necrotic", { knownness: 0.83 })]),
    );

    expect(joined.buckets?.withoutReading).toEqual([
      { word: "necrotic", knownness: 0.83, composed: null },
    ]);
    expect(joined.buckets?.demotable).toEqual([]);
  });

  it("orders the main pile by knownness, best known first", () => {
    const joined = joinPastedList(
      "cirrhotic\nmacrobiotic\nnecrotic\northotic",
      day(["chaotic"]),
      evidence([
        facts("cirrhotic", { knownness: 0.46 }),
        facts("macrobiotic", { knownness: 0.95 }),
        facts("necrotic", { knownness: 0.83 }),
        facts("orthotic", { knownness: 0.78 }),
      ]),
    );

    expect(joined.buckets?.withoutReading.map((entry) => entry.word)).toEqual([
      "macrobiotic",
      "necrotic",
      "orthotic",
      "cirrhotic",
    ]);
  });

  it("keeps a word with no prevalence row in the main pile, ordered last", () => {
    // The rule the bucket is shaped around: a word with no row already resolves
    // to a Bonus Word in the Rhyme Index, so filtering on knownness would hide
    // exactly the finds a player digs for. Knownness sorts; it never shortens.
    const joined = joinPastedList(
      "zymotic\ncirrhotic\nnecrotic",
      day(["chaotic"]),
      evidence([
        facts("zymotic", { knownness: null }),
        facts("cirrhotic", { knownness: 0.46 }),
        facts("necrotic", { knownness: 0.83 }),
      ]),
    );

    expect(joined.buckets?.withoutReading.map((entry) => entry.word)).toEqual([
      "necrotic",
      "cirrhotic",
      "zymotic",
    ]);
  });

  it("leaves two unmeasured words in the order the paste gave them", () => {
    const joined = joinPastedList(
      "zymotic\nazotic",
      day(["chaotic"]),
      evidence([facts("zymotic", { knownness: null }), facts("azotic", { knownness: null })]),
    );

    expect(joined.buckets?.withoutReading.map((entry) => entry.word)).toEqual(["zymotic", "azotic"]);
  });

  it("marks a compound whose composed reading reaches the day's key", () => {
    const reading = composed(["R", "OW1", "B", "OW0", "T", "IH2", "K"]);
    const joined = joinPastedList(
      "robotic",
      day(["chaotic"]),
      evidence([facts("robotic", { composed: reading })]),
    );

    expect(joined.buckets?.withoutReading).toEqual([
      { word: "robotic", knownness: 0.5, composed: reading },
    ]);
  });

  it("does not mark a compound no split reaches the day's key for", () => {
    const joined = joinPastedList(
      "necrotic",
      day(["chaotic"]),
      evidence([facts("necrotic", { composed: null })]),
    );

    expect(joined.buckets?.withoutReading).toEqual([
      { word: "necrotic", knownness: 0.5, composed: null },
    ]);
  });

  it("drops a composed reading that landed on some other key", () => {
    // `composeReading` puts every candidate through `verifyReading`, which is
    // exact equality against the target, so nothing upstream should offer this.
    // The rule that a word is resolvable *only* on the day's key is the
    // feature's, ADR-0014 is what it costs to get wrong, and it is read off here
    // rather than trusted to whoever supplied the facts.
    const joined = joinPastedList(
      "robotic",
      day(["chaotic"]),
      evidence([
        facts("robotic", { composed: composed(["R", "OW1", "B", "AA2", "T"], "AA T") }),
      ]),
    );

    expect(joined.buckets?.withoutReading).toEqual([
      { word: "robotic", knownness: 0.5, composed: null },
    ]);
  });

  it("offers a word absent from the word list as a demotion", () => {
    const joined = joinPastedList(
      "quotic",
      day(["chaotic"]),
      evidence([facts("quotic", { isWord: false, knownness: null })]),
    );

    expect(joined.buckets?.demotable).toEqual([
      { word: "quotic", reason: "not-a-known-word" },
    ]);
    expect(joined.buckets?.withoutReading).toEqual([]);
  });

  it("offers a Proper Noun as a name rather than putting it in the main pile", () => {
    const joined = joinPastedList(
      "scotic",
      day(["chaotic"]),
      evidence([facts("scotic", { isWord: false, isName: true, knownness: null })]),
    );

    expect(joined.buckets?.demotable).toEqual([{ word: "scotic", reason: "proper-noun" }]);
    expect(joined.buckets?.withoutReading).toEqual([]);
  });

  it("offers a name the word list still holds as a name all the same", () => {
    // `data/words.txt` and `data/names.txt` overlap — `kate` is in both — and the
    // evidence context applies no demotions, so a name nobody has demoted yet
    // reads as having wordhood. That is the demotion worth making, not a word to
    // put in the pile of things to add.
    const joined = joinPastedList(
      "kate",
      day(["chaotic"]),
      evidence([facts("kate", { isWord: true, isName: true, knownness: 0.4 })]),
    );

    expect(joined.buckets?.demotable).toEqual([{ word: "kate", reason: "proper-noun" }]);
    expect(joined.buckets?.withoutReading).toEqual([]);
  });

  it("orders a word measured below zero above one with no row at all", () => {
    // `data/prevalence.csv` is not a 0–1 scale: 1,531 rows sit below −1. A
    // sentinel would file those under a word nobody has measured, which is the
    // one thing this ordering promises not to do.
    const joined = joinPastedList(
      "zymotic\nazotic",
      day(["chaotic"]),
      evidence([facts("zymotic", { knownness: null }), facts("azotic", { knownness: -4.2 })]),
    );

    expect(joined.buckets?.withoutReading.map((entry) => entry.word)).toEqual(["azotic", "zymotic"]);
  });

  it("holds a word we already read on another key apart from both piles", () => {
    const joined = joinPastedList(
      "necrotic",
      day(["chaotic"]),
      evidence([
        facts("necrotic", {
          direct: [{ phonemes: ["N", "EH1", "K", "R", "AA1", "T", "IH0", "K"], key: "AA T IH K" }],
        }),
      ]),
    );

    expect(joined.buckets?.withoutReading).toEqual([]);
    expect(joined.buckets?.demotable).toEqual([]);
    expect(joined.buckets?.readsElsewhere).toEqual([
      { word: "necrotic", readings: [{ respelling: "NEH-krah-tih-k", key: "AA T IH K" }] },
    ]);
  });

  it("splits a mixed residue into all three piles at once", () => {
    const joined = joinPastedList(
      "biotic\nkate\nquadratic\nmacrobiotic",
      day(["chaotic"]),
      evidence([
        facts("biotic", { knownness: 0.89 }),
        facts("kate", { isWord: false, isName: true, knownness: null }),
        facts("quadratic", {
          direct: [{ phonemes: ["R", "OW1", "B", "AA2", "T", "IH0", "K"], key: "AA T IH K" }],
        }),
        facts("macrobiotic", { knownness: 0.95 }),
      ]),
    );

    expect(joined.covered).toBe(0);
    expect(joined.buckets?.withoutReading.map((entry) => entry.word)).toEqual(["macrobiotic", "biotic"]);
    expect(joined.buckets?.readsElsewhere.map((entry) => entry.word)).toEqual(["quadratic"]);
    expect(joined.buckets?.demotable.map((entry) => entry.word)).toEqual(["kate"]);
  });

  it("still counts what the day covers, and never buckets it", () => {
    const joined = joinPastedList(
      "chaotic\nnecrotic",
      day(["chaotic"]),
      evidence([facts("necrotic", { knownness: 0.83 })]),
    );

    expect(joined).toMatchObject({ pasted: 2, covered: 1, residue: ["necrotic"] });
    expect(joined.buckets?.withoutReading.map((entry) => entry.word)).toEqual(["necrotic"]);
  });

  it("refuses evidence gathered against another Rhyme Key", () => {
    // Composition is aimed at one target (ADR-0014), so facts fetched for a day
    // the editor has since navigated away from would mark the wrong words
    // resolvable. The screen goes back to "not looked up", which is what is true.
    const joined = joinPastedList(
      "necrotic",
      day(["chaotic"]),
      evidence([facts("necrotic")], "EY T"),
    );

    expect(joined.buckets).toBeNull();
  });

  it("returns empty buckets for an empty residue, rather than none at all", () => {
    const joined = joinPastedList("chaotic", day(["chaotic"]), evidence([]));

    expect(joined.buckets).toEqual({ withoutReading: [], readsElsewhere: [], demotable: [] });
  });

  it("refuses evidence that does not answer about the whole residue", () => {
    // The editor typed into the box after asking, or a rebuild made the day
    // longer. A partial split is worse than none: the words it silently left out
    // are the ones nobody would then think to look at, and a bucket short of a
    // word reads as a word the tool considered and rejected.
    const joined = joinPastedList(
      "necrotic\nbiotic",
      day(["chaotic"]),
      evidence([facts("necrotic")]),
    );

    expect(joined.residue).toEqual(["necrotic", "biotic"]);
    expect(joined.buckets).toBeNull();
  });

  it("spends evidence that answers about more than the residue", () => {
    // The other direction, and the ordinary one: an add rebuilt the index and a
    // word the lookup asked about is now an Answer. The rest of the reply is
    // still about the rest of the list.
    const joined = joinPastedList(
      "chaotic\nnecrotic",
      day(["chaotic"]),
      evidence([facts("necrotic"), facts("chaotic")]),
    );

    expect(joined.buckets?.withoutReading.map((entry) => entry.word)).toEqual(["necrotic"]);
  });
});

/**
 * The bulk accept (#190): which of the main pile one gesture may carry, and
 * which reading it already tried and could not use.
 *
 * Pure, like the join above, and tested the same way — a literal pile and a
 * literal outcome in, a literal batch out. The gesture that posts the batch is
 * the add route's own and is tested where that route is; what is tested here is
 * only the rule about *what goes in it*.
 */
function pile(...words: (string | WordWithoutReading)[]): WordWithoutReading[] {
  return words.map((entry) =>
    typeof entry === "string" ? { word: entry, knownness: 0.5, composed: null } : entry,
  );
}

function outcome(words: WordOutcome[], target = IDIOTIC): AddOutcome {
  return { target, provenance: "the day", seed: "idiotic", words };
}

/** A word the agent proposed a reading for that did not land on the target. */
function failed(word: string, proposed: Pronunciation): WordOutcome {
  return { outcome: "deferred", word, reason: "agent-reading-failed-verification", proposed };
}

describe("pileToAccept", () => {
  it("carries the whole pile when nothing has been tried yet", () => {
    expect(pileToAccept(pile("necrotic", "orthotic", "cirrhotic"), new Map())).toEqual([
      "necrotic",
      "orthotic",
      "cirrhotic",
    ]);
  });

  it("carries a word no compound split reaches, rather than only the composed ones", () => {
    const composes: WordWithoutReading = {
      word: "robotic",
      knownness: 0.9,
      composed: composed(["R", "OW0", "B", "AA1", "T", "IH0", "K"]),
    };

    expect(pileToAccept(pile(composes, "necrotic"), new Map())).toEqual(["robotic", "necrotic"]);
  });

  it("holds back a word whose sourced reading failed verification", () => {
    const refused = new Map([["necrotic", "neh-KROT-ik"]]);

    expect(pileToAccept(pile("necrotic", "orthotic"), refused)).toEqual(["orthotic"]);
  });

  it("keeps the pile's own order, which is knownness descending", () => {
    expect(pileToAccept(pile("macrobiotic", "biotic", "necrotic"), new Map())).toEqual([
      "macrobiotic",
      "biotic",
      "necrotic",
    ]);
  });

  it("carries nothing when every word in the pile was refused", () => {
    const refused = new Map([
      ["necrotic", "neh-KROT-ik"],
      ["orthotic", "or-THOT-ik"],
    ]);

    expect(pileToAccept(pile("necrotic", "orthotic"), refused)).toEqual([]);
  });

  it("carries nothing from an empty pile", () => {
    expect(pileToAccept([], new Map())).toEqual([]);
  });
});

describe("refusedReadings", () => {
  it("finds nothing before any add has run", () => {
    expect(refusedReadings(null, IDIOTIC)).toEqual(new Map());
  });

  it("names the word against what was proposed for it, respelled", () => {
    const refused = refusedReadings(
      outcome([failed("necrotic", ["N", "EH1", "K", "R", "AH0", "T"])]),
      IDIOTIC,
    );

    expect([...refused.keys()]).toEqual(["necrotic"]);
    expect(refused.get("necrotic")).not.toContain("EH1");
  });

  it("leaves a word the agent never answered about out of the map", () => {
    const unavailable: WordOutcome = {
      outcome: "deferred",
      word: "orthotic",
      reason: "agent-unavailable",
      proposed: null,
    };

    expect(refusedReadings(outcome([unavailable]), IDIOTIC)).toEqual(new Map());
  });

  it("leaves a word that was written out of the map", () => {
    const written: WordOutcome = {
      outcome: "written",
      word: "robotic",
      phonemes: ["R", "OW0", "B", "AA1", "T", "IH0", "K"],
      composed: null,
    };

    expect(refusedReadings(outcome([written]), IDIOTIC)).toEqual(new Map());
  });

  it("refuses an outcome judged against another Rhyme Key", () => {
    const elsewhere = outcome([failed("necrotic", ["N", "EH1", "K"])], "AH S T");

    expect(refusedReadings(elsewhere, IDIOTIC)).toEqual(new Map());
  });

  it("holds every refused reading in one batch", () => {
    const refused = refusedReadings(
      outcome([
        failed("necrotic", ["N", "EH1", "K"]),
        { outcome: "refused-name", word: "kate" },
        failed("orthotic", ["AO1", "R", "TH"]),
      ]),
      IDIOTIC,
    );

    expect([...refused.keys()]).toEqual(["necrotic", "orthotic"]);
  });
});
