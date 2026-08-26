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
  mergeRefusals,
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

    expect(joined).toEqual({
      pasted: 3,
      covered: 2,
      residue: ["necrotic"],
      lookup: ["necrotic"],
      buckets: null,
    });
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

    expect(joined).toEqual({
      pasted: 1,
      covered: 0,
      residue: ["necrotic"],
      lookup: ["necrotic", "chaotic"],
      buckets: null,
    });
  });

  it("drops malformed entries silently", () => {
    const joined = joinPastedList("necrotic\nb1otic\nchaotic¹\nx.y\n'", day([]));

    expect(joined).toEqual({
      pasted: 1,
      covered: 0,
      residue: ["necrotic"],
      lookup: ["necrotic"],
      buckets: null,
    });
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
      lookup: ["necrotic", "biotic", "chaotic"],
      buckets: null,
    });
  });

  it("reads a comma-separated paste as entries, not as one phrase", () => {
    const joined = joinPastedList("chaotic, necrotic, hard hat", day(["chaotic"]));

    expect(joined).toEqual({
      pasted: 2,
      covered: 1,
      residue: ["necrotic"],
      lookup: ["necrotic"],
      buckets: null,
    });
  });

  it("returns empty buckets for an empty paste rather than failing", () => {
    const nothing = { pasted: 0, covered: 0, residue: [], lookup: [], buckets: null };

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

    expect(joined).toEqual({ pasted: 0, covered: 0, residue: [], lookup: [], buckets: null });
  });

  it("joins to nothing when the readout is not a day", () => {
    const nothing = { pasted: 0, covered: 0, residue: [], lookup: [], buckets: null };

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
      { word: "quotic", reason: "not-a-known-word", writes: false },
    ]);
    expect(joined.buckets?.withoutReading).toEqual([]);
  });

  it("offers a Proper Noun as a name rather than putting it in the main pile", () => {
    const joined = joinPastedList(
      "scotic",
      day(["chaotic"]),
      evidence([facts("scotic", { isWord: false, isName: true, knownness: null })]),
    );

    expect(joined.buckets?.demotable).toEqual([
      { word: "scotic", reason: "proper-noun", writes: false },
    ]);
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

    expect(joined.buckets?.demotable).toEqual([
      { word: "kate", reason: "proper-noun", writes: true },
    ]);
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

  it("offers no bucket at all for a word the demotion list already names", () => {
    // A dismissal has to stick, and the durable half of that is
    // `data/demotions.txt`: the word has no wordhood on any day, so there is
    // nothing left to add it as and nothing left to demote it for.
    const joined = joinPastedList(
      "kate\nnecrotic",
      day(["chaotic"]),
      evidence([facts("kate", { isName: true, knownness: 0.4 }), facts("necrotic")]),
      new Set(["kate"]),
    );

    expect(joined.buckets?.demotable).toEqual([]);
    expect(joined.buckets?.withoutReading.map((entry) => entry.word)).toEqual(["necrotic"]);
  });

  it("keeps a demoted word out of the main pile too, not just the demotions", () => {
    // The evidence context applies no demotions, so a demoted word still reads
    // as having wordhood. Taking the demotion list at its word here is what
    // stops the tool asking an agent for a reading for a word the game has
    // already refused to serve.
    const joined = joinPastedList(
      "lbs",
      day(["chaotic"]),
      evidence([facts("lbs", { knownness: 0.2 })]),
      new Set(["lbs"]),
    );

    expect(joined.buckets).toEqual({
      omittedAnswers: [],
      withoutReading: [],
      readsElsewhere: [],
      demotable: [],
    });
  });

  it("counts a demoted word in the residue all the same", () => {
    // The residue is what the evidence reply is asked about, and the reply is
    // refused unless it answers about all of it. Shortening the residue on a
    // dismissal would take every bucket off the screen with the dismissed row.
    const joined = joinPastedList(
      "kate\nnecrotic",
      day(["chaotic"]),
      evidence([facts("kate", { isName: true }), facts("necrotic")]),
      new Set(["kate"]),
    );

    expect(joined).toMatchObject({ pasted: 2, covered: 0, residue: ["kate", "necrotic"] });
    expect(joined.buckets).not.toBeNull();
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

    expect(joined.buckets).toEqual({
      omittedAnswers: [],
      withoutReading: [],
      readsElsewhere: [],
      demotable: [],
    });
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

/** A word an add gave a reading to — the outcome that settles it for good. */
function written(word: string): WordOutcome {
  return {
    outcome: "written",
    word,
    phonemes: ["R", "OW0", "B", "AA1", "T", "IH0", "K"],
    composed: null,
  };
}

/**
 * The one bucket that runs the other way: day **Answers** the pasted list leaves
 * out (#192).
 *
 * Read-only and framed neutrally by design — a third party's omission is
 * sometimes a signal that our reading is wrong and sometimes just an omission —
 * so what is asserted here is only membership, ordering and the respelling. No
 * verdict travels on these rows, and there is none to test.
 *
 * The respellings are literals rather than calls to `respell`, which would be a
 * second copy of the thing under test. `kay-AH-tih-k` is what
 * `K EY0 AA1 T IH0 K` respells to.
 */
describe("joinPastedList: the day's Answers the list omits", () => {
  const CHAOTIC: Pronunciation = ["K", "EY0", "AA1", "T", "IH0", "K"];
  const HYPNOTIC: Pronunciation = ["HH", "IH0", "P", "N", "AA1", "T", "IH0", "K"];

  it("puts a day Answer the paste leaves out in its own bucket, respelled", () => {
    const joined = joinPastedList(
      "necrotic",
      day(["chaotic"]),
      evidence([
        facts("necrotic"),
        facts("chaotic", { direct: [{ phonemes: CHAOTIC, key: IDIOTIC }] }),
      ]),
    );

    expect(joined.buckets?.omittedAnswers).toEqual([
      { word: "chaotic", readings: [{ respelling: "kay-AH-tih-k", key: IDIOTIC }] },
    ]);
  });

  it("leaves an Answer the paste does hold out of the bucket, whatever its casing", () => {
    const joined = joinPastedList(
      "CHAOTIC\nnecrotic",
      day(["chaotic"]),
      evidence([facts("necrotic")]),
    );

    expect(joined.buckets?.omittedAnswers).toEqual([]);
  });

  it("leaves Bonus Words out of the bucket entirely", () => {
    // The bucket asks whether a word we serve as part of the Puzzle is one a
    // third party would not. A Bonus Word is already the game saying almost
    // nobody knows this, so a rhyme list omitting one is the expected case.
    const joined = joinPastedList(
      "chaotic",
      day(["chaotic"], ["zymotic"]),
      evidence([]),
    );

    expect(joined.lookup).toEqual([]);
    expect(joined.buckets?.omittedAnswers).toEqual([]);
  });

  it("shows every reading we hold, with the key each of them lands on", () => {
    const joined = joinPastedList(
      "necrotic",
      day(["tear"]),
      evidence([
        facts("necrotic"),
        facts("tear", {
          direct: [
            { phonemes: ["T", "IH1", "R"], key: "IH R" },
            { phonemes: ["T", "EH1", "R"], key: "EH R" },
          ],
        }),
      ]),
    );

    expect(joined.buckets?.omittedAnswers).toEqual([
      {
        word: "tear",
        readings: [
          { respelling: "TIH-r", key: "IH R" },
          { respelling: "TEH-r", key: "EH R" },
        ],
      },
    ]);
  });

  it("keeps the Answers in the day's own order", () => {
    const joined = joinPastedList(
      "necrotic",
      day(["chaotic", "hypnotic"]),
      evidence([
        facts("necrotic"),
        facts("chaotic", { direct: [{ phonemes: CHAOTIC, key: IDIOTIC }] }),
        facts("hypnotic", { direct: [{ phonemes: HYPNOTIC, key: IDIOTIC }] }),
      ]),
    );

    expect(joined.buckets?.omittedAnswers.map((entry) => entry.word)).toEqual([
      "chaotic",
      "hypnotic",
    ]);
  });

  it("leaves out an Answer the game no longer holds", () => {
    // On its way out of the Puzzle at the next rebuild, so asking the editor to
    // weigh our reading of it is asking about a word that will not be there.
    const joined = joinPastedList(
      "necrotic",
      day(["chaotic", "algiers"]),
      evidence([
        facts("necrotic"),
        facts("chaotic", { direct: [{ phonemes: CHAOTIC, key: IDIOTIC }] }),
      ]),
      new Set(["algiers"]),
    );

    expect(joined.lookup).toEqual(["necrotic", "chaotic"]);
    expect(joined.buckets?.omittedAnswers.map((entry) => entry.word)).toEqual(["chaotic"]);
  });

  it("asks one lookup about the residue and the absent Answers together", () => {
    const joined = joinPastedList("necrotic\nbiotic", day(["chaotic", "hypnotic"]));

    expect(joined.lookup).toEqual(["necrotic", "biotic", "chaotic", "hypnotic"]);
  });

  it("asks about nothing at all when the paste held no words", () => {
    // With no third-party list there is no third party to disagree with, and
    // every Answer would otherwise read as omitted by a list that does not exist.
    expect(joinPastedList("", day(["chaotic"])).lookup).toEqual([]);
    expect(joinPastedList("chaotic necrotic biotic", day(["chaotic"])).lookup).toEqual([]);
  });

  it("splits the residue even when the evidence is short of an absent Answer", () => {
    // The asymmetry with the residue is deliberate. Refusing the whole split —
    // the accepts, the demotions — because a read-only comparison came up short
    // would trade the pile the editor acts on for the one they only read.
    const joined = joinPastedList(
      "necrotic",
      day(["chaotic"]),
      evidence([facts("necrotic", { knownness: 0.83 })]),
    );

    expect(joined.buckets?.withoutReading).toEqual([
      { word: "necrotic", knownness: 0.83, composed: null },
    ]);
    expect(joined.buckets?.omittedAnswers).toEqual([]);
  });
});

describe("pileToAccept", () => {
  it("carries the whole pile when nothing has been tried yet", () => {
    expect(pileToAccept(pile("necrotic", "orthotic", "cirrhotic"), new Map()).words).toEqual([
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

    expect(pileToAccept(pile(composes, "necrotic"), new Map())).toEqual({
      words: ["robotic", "necrotic"],
      composes: 1,
    });
  });

  it("holds back a word whose sourced reading failed verification", () => {
    const refused = new Map([["necrotic", "neh-KROT-ik"]]);

    expect(pileToAccept(pile("necrotic", "orthotic"), refused).words).toEqual(["orthotic"]);
  });

  it("keeps the pile's own order, which is knownness descending", () => {
    expect(pileToAccept(pile("macrobiotic", "biotic", "necrotic"), new Map()).words).toEqual([
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

    expect(pileToAccept(pile("necrotic", "orthotic"), refused)).toEqual({
      words: [],
      composes: 0,
    });
  });

  it("carries nothing from an empty pile", () => {
    expect(pileToAccept([], new Map())).toEqual({ words: [], composes: 0 });
  });

  it("counts nothing as composing when no split reaches the key", () => {
    expect(pileToAccept(pile("necrotic", "orthotic"), new Map()).composes).toBe(0);
  });

  // The count is a partition of the batch and not of the pile: it is printed
  // under the button as a claim about the words the request carries, so a word
  // held back cannot be counted among the ones about to be written.
  it("does not count a composing word the refusals held back", () => {
    const composes: WordWithoutReading = {
      word: "robotic",
      knownness: 0.9,
      composed: composed(["R", "OW0", "B", "AA1", "T", "IH0", "K"]),
    };
    const refused = new Map([["robotic", "ROH-bo-tik"]]);

    expect(pileToAccept(pile(composes, "necrotic"), refused)).toEqual({
      words: ["necrotic"],
      composes: 0,
    });
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

/**
 * Refusals survive more than one request (#190).
 *
 * The hook holds the map and this is the whole of what it does to it, so the
 * rule is tested here over literals — a held map and an outcome in, the map as
 * it now stands out — for the reason every other rule in this feature is.
 */
describe("mergeRefusals", () => {
  it("holds nothing before any add has run", () => {
    expect(mergeRefusals(new Map(), null, IDIOTIC)).toEqual(new Map());
  });

  it("adds what this outcome refused", () => {
    const merged = mergeRefusals(
      new Map(),
      outcome([failed("necrotic", ["N", "EH1", "K", "R", "AH0", "T"])]),
      IDIOTIC,
    );

    expect([...merged.keys()]).toEqual(["necrotic"]);
  });

  // The case the accumulation exists for: a second accept, or any typed Submit
  // on the day tab, replaces the outcome on the hook. A refusal read off that
  // alone would last exactly one round.
  it("keeps a refusal an earlier request made when a later one says nothing about it", () => {
    const held = new Map([["necrotic", "neh-KROT-ik"]]);

    const merged = mergeRefusals(held, outcome([written("robotic")]), IDIOTIC);

    expect(merged.get("necrotic")).toBe("neh-KROT-ik");
  });

  it("carries every standing refusal alongside a new one", () => {
    const held = new Map([["necrotic", "neh-KROT-ik"]]);

    const merged = mergeRefusals(
      held,
      outcome([failed("orthotic", ["AO1", "R", "TH"])]),
      IDIOTIC,
    );

    expect([...merged.keys()]).toEqual(["necrotic", "orthotic"]);
  });

  // What makes "Ask again" honest: the agent is not deterministic, a second ask
  // can land, and a word that now reads has nothing left to judge.
  it("clears the mark on a word this outcome wrote a reading for", () => {
    const held = new Map([["necrotic", "neh-KROT-ik"]]);

    const merged = mergeRefusals(held, outcome([written("necrotic")]), IDIOTIC);

    expect(merged.has("necrotic")).toBe(false);
  });

  it("clears one word's mark and leaves the rest standing", () => {
    const held = new Map([
      ["necrotic", "neh-KROT-ik"],
      ["orthotic", "or-THOT-ik"],
    ]);

    const merged = mergeRefusals(held, outcome([written("necrotic")]), IDIOTIC);

    expect([...merged.keys()]).toEqual(["orthotic"]);
  });

  it("leaves the held map alone rather than mutating it", () => {
    const held = new Map([["necrotic", "neh-KROT-ik"]]);

    mergeRefusals(held, outcome([written("necrotic")]), IDIOTIC);

    expect(held.has("necrotic")).toBe(true);
  });

  it("changes nothing on an outcome judged against another Rhyme Key", () => {
    const held = new Map([["necrotic", "neh-KROT-ik"]]);
    const elsewhere = outcome([written("necrotic"), failed("orthotic", ["AO1"])], "AH S T");

    expect(mergeRefusals(held, elsewhere, IDIOTIC)).toEqual(held);
  });

  it("changes nothing on a null outcome", () => {
    const held = new Map([["necrotic", "neh-KROT-ik"]]);

    expect(mergeRefusals(held, null, IDIOTIC)).toEqual(held);
  });

  it("leaves a word the agent never answered about unmarked", () => {
    const unavailable: WordOutcome = {
      outcome: "deferred",
      word: "orthotic",
      reason: "agent-unavailable",
      proposed: null,
    };

    expect(mergeRefusals(new Map(), outcome([unavailable]), IDIOTIC)).toEqual(new Map());
  });

  it("replaces a standing refusal with what the latest ask proposed", () => {
    const held = new Map([["necrotic", "neh-KROT-ik"]]);

    const merged = mergeRefusals(
      held,
      outcome([failed("necrotic", ["N", "IY1", "K", "R", "AH0", "T"])]),
      IDIOTIC,
    );

    expect(merged.get("necrotic")).not.toBe("neh-KROT-ik");
  });
});
