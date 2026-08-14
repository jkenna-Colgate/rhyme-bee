/**
 * Slice: correcting a reading the engine already holds (#180). The proposal, the
 * replace-versus-join write, and the recheck that follows the union of the
 * word's Rhyme Keys before and after.
 *
 * Built the way `editorAdd.test.ts` is, because it is the same seam: the
 * pinned-source context is assembled by hand rather than read off `data/`, and
 * the agent is a stub rather than a subprocess. What is new here is the second
 * half — the write and the rebuild — which is driven over a temp file and two
 * fixture indexes, the second built with the correction's own lines merged in.
 * That is what makes "a word corrected by join is accepted on either
 * pronunciation" an assertion against the *real* parser and the real
 * adjudication rather than a comment claiming they were not modified.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Derivation, IndexDataSource } from "../../src/derivation.ts";
import type { Pronunciation, RhymeKey } from "../../src/phonology.ts";
import { respell } from "../../src/respelling.ts";
import type { PuzzleFacts, Schedule } from "../../src/schedule.ts";
import type { EvidenceContext, WordEvidence } from "../../src/supplementEvidence.ts";
import { makeTestIndex } from "../../src/__fixtures__/index.ts";
import type { ScheduledDayReadout } from "../editorDay.ts";
import {
  applyCorrection,
  correctionLines,
  daysOnKeys,
  movementOf,
  proposeCorrection,
  readingsToWrite,
} from "../editorCorrection.ts";

function context(overrides: {
  pronunciations?: [string, Pronunciation[]][];
  words?: string[];
  names?: string[];
} = {}): EvidenceContext {
  const pronunciations = new Map(overrides.pronunciations ?? []);
  const words = new Set(overrides.words ?? []);
  const names = new Set(overrides.names ?? []);
  const derivation = new Derivation(new IndexDataSource({ words, pronunciations }));
  return { pronunciations, words, names, derivation };
}

const TARGET: RhymeKey = "EY T";

// `cat` is the correction case: the engine reads it, and not on the target.
// `gate` already reaches the target, and `gleeb` has no reading at all — the two
// cases that are *not* corrections.
const ctx = context({
  pronunciations: [
    ["cat", [["K", "AE1", "T"]]],
    ["gate", [["G", "EY1", "T"]]],
  ],
  words: ["cat", "gate"],
});

/** Never called for a word `proposeCorrection` must not reach an agent for. */
const unreachable = vi.fn(async ({ word }: WordEvidence): Promise<Pronunciation | null> => {
  throw new Error(`agent should not have been asked about "${word}"`);
});

describe("proposeCorrection", () => {
  it("hands the agent the evidence record, existing readings included", async () => {
    const author = vi.fn(async () => ["K", "EY1", "T"] as Pronunciation);
    await proposeCorrection("cat", TARGET, ctx, author);
    expect(author).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "cat",
        target: TARGET,
        direct: [{ phonemes: ["K", "AE1", "T"], key: "AE T" }],
      }),
    );
  });

  it("shows the proposal beside the engine's reading, with its key and respelling", async () => {
    const author = vi.fn(async () => ["K", "EY1", "T"] as Pronunciation);
    const outcome = await proposeCorrection("cat", TARGET, ctx, author);
    expect(outcome).toEqual({
      outcome: "proposed",
      word: "cat",
      target: TARGET,
      current: [{ phonemes: ["K", "AE1", "T"], key: "AE T" }],
      phonemes: ["K", "EY1", "T"],
      key: "EY T",
      respelling: respell(["K", "EY1", "T"]),
      reaches: true,
    });
  });

  it("reports a proposal that misses the target rather than refusing it", async () => {
    // The honest reading: the player was wrong, and this is what the word really
    // sounds like. Approving it is the Decline, and it is the same value.
    const author = vi.fn(async () => ["K", "AA1", "T"] as Pronunciation);
    const outcome = await proposeCorrection("cat", TARGET, ctx, author);
    expect(outcome).toMatchObject({
      outcome: "proposed",
      phonemes: ["K", "AA1", "T"],
      key: "AA T",
      reaches: false,
    });
  });

  it("reports an agent that did not answer, having written nothing", async () => {
    const outcome = await proposeCorrection("cat", TARGET, ctx, async () => null);
    expect(outcome).toEqual({
      outcome: "agent-unavailable",
      word: "cat",
      target: TARGET,
      current: [{ phonemes: ["K", "AE1", "T"], key: "AE T" }],
    });
  });

  it("never asks about a word that already reaches the target", async () => {
    const outcome = await proposeCorrection("gate", TARGET, ctx, unreachable);
    expect(outcome).toEqual({
      outcome: "nothing-to-correct",
      word: "gate",
      target: TARGET,
      current: [{ phonemes: ["G", "EY1", "T"], key: "EY T" }],
      rhymesDirectly: true,
    });
  });

  it("never asks about a word the engine has no reading for — that is an add", async () => {
    const outcome = await proposeCorrection("gleeb", TARGET, ctx, unreachable);
    expect(outcome).toEqual({
      outcome: "nothing-to-correct",
      word: "gleeb",
      target: TARGET,
      current: [],
      rhymesDirectly: false,
    });
  });
});

describe("what replace and join write", () => {
  const current: Pronunciation[] = [["G", "EY1", "T"]];
  const proposed: Pronunciation = ["G", "AE1", "T"];

  it("writes one reading for a replace, standing in place of the engine's", () => {
    expect(readingsToWrite(current, proposed, "replace")).toEqual([["G", "AE1", "T"]]);
  });

  it("writes both for a join, the engine's first", () => {
    expect(readingsToWrite(current, proposed, "join")).toEqual([
      ["G", "EY1", "T"],
      ["G", "AE1", "T"],
    ]);
  });

  it("writes a join's reading once when the engine already holds it", () => {
    expect(readingsToWrite(current, ["G", "EY1", "T"], "join")).toEqual([["G", "EY1", "T"]]);
  });

  it("spells a join as alternate-pronunciation entries and nothing new", () => {
    const text = correctionLines({
      word: "gate",
      mode: "join",
      target: "AE T",
      readings: [
        ["G", "EY1", "T"],
        ["G", "AE1", "T"],
      ],
    });
    const entries = text.split("\n").filter((line) => !line.startsWith("#"));
    expect(entries).toEqual(["gate G EY1 T", "gate(2) G AE1 T"]);
  });

  it("spells a replace as the one entry the supplement has always written", () => {
    const text = correctionLines({
      word: "gate",
      mode: "replace",
      target: "AE T",
      readings: [["G", "AE1", "T"]],
    });
    expect(text.split("\n").filter((line) => !line.startsWith("#"))).toEqual(["gate G AE1 T"]);
  });
});

/**
 * The acceptance criterion, asserted against the shipped build rather than
 * described: the lines a join writes go into `makeTestIndex`'s supplement, which
 * runs the same four stages `npm run build:index` runs, and the word comes back
 * in **both** Puzzles.
 *
 * Nothing here reaches past the index's own interface. If `parseCmudict`'s
 * alternate merge or `applySupplement` had been modified to make this pass, the
 * replace case below would have stopped passing in the same breath — which is
 * why both are asserted and not only the interesting one.
 */
describe("a word corrected by join, through a real build", () => {
  const joined = makeTestIndex({
    supplement: correctionLines({
      word: "gate",
      mode: "join",
      target: "AE T",
      readings: [
        ["G", "EY1", "T"],
        ["G", "AE1", "T"],
      ],
    }),
  });

  const replaced = makeTestIndex({
    supplement: correctionLines({
      word: "gate",
      mode: "replace",
      target: "AE T",
      readings: [["G", "AE1", "T"]],
    }),
  });

  function membersOf(index: ReturnType<typeof makeTestIndex>, seed: string): string[] {
    const puzzle = index.buildPuzzle(index.pinSeed(seed));
    return [...puzzle.answers, ...puzzle.bonusWords].map((entry) => entry.word);
  }

  it("holds both Rhyme Keys for the word", () => {
    expect(joined.rhymeKeysOf("gate").sort()).toEqual(["AE T", "EY T"]);
  });

  it("is accepted on either pronunciation — it is in both Puzzles", () => {
    expect(membersOf(joined, "ate")).toContain("gate");
    expect(membersOf(joined, "hat")).toContain("gate");
  });

  it("a replace moves the word instead, which is what makes the choice matter", () => {
    expect(replaced.rhymeKeysOf("gate")).toEqual(["AE T"]);
    expect(membersOf(replaced, "hat")).toContain("gate");
    expect(membersOf(replaced, "ate")).not.toContain("gate");
  });
});

describe("the days a correction is rechecked over", () => {
  const schedule = scheduleOf([
    { date: "2026-09-01", seed: "ate", rhymeKey: "EY T" },
    { date: "2026-09-02", seed: "hat", rhymeKey: "AE T" },
    { date: "2026-09-03", seed: "bed", rhymeKey: "EH D" },
  ]);

  it("takes the days on the union of the keys, and no others", () => {
    expect(daysOnKeys(schedule, ["EY T", "AE T"]).map((day) => day.date)).toEqual([
      "2026-09-01",
      "2026-09-02",
    ]);
  });

  it("takes no day for a key the schedule never dealt", () => {
    expect(daysOnKeys(schedule, ["UW L"])).toEqual([]);
  });
});

describe("what counts as a day having moved", () => {
  const day = { date: "2026-09-01", seed: "ate", rhymeKey: "EY T" };
  const facts: PuzzleFacts = { answerCount: 3, maxScore: 20, difficulty: 0.25 };

  it("is unmoved when the figures and the lists are the same", () => {
    const readout = dayReadout({ facts, answers: ["late"], bonusWords: [] });
    expect(movementOf("gate", day, readout, readout).moved).toBe(false);
  });

  it("moves when a figure moves", () => {
    const before = dayReadout({ facts, answers: ["late"], bonusWords: [] });
    const after = dayReadout({
      facts: { ...facts, answerCount: 4 },
      answers: ["late", "gate"],
      bonusWords: [],
    });
    expect(movementOf("gate", day, before, after)).toMatchObject({
      moved: true,
      heldBefore: false,
      heldAfter: true,
      before: facts,
      after: { answerCount: 4 },
    });
  });

  it("moves when the word arrives as a Bonus Word, which moves no figure at all", () => {
    // Bonus Words are celebrated and not counted (CONTEXT.md), so `facts` is
    // identical either side. The word is still on a Puzzle it was not on, which
    // is exactly the change a figures-only comparison would report as silence.
    const before = dayReadout({ facts, answers: ["late"], bonusWords: [] });
    const after = dayReadout({ facts, answers: ["late"], bonusWords: ["gate"] });
    expect(movementOf("gate", day, before, after)).toMatchObject({
      moved: true,
      heldBefore: false,
      heldAfter: true,
    });
  });

  it("names the day from the schedule even when neither side would read", () => {
    expect(movementOf("gate", day, null, null)).toEqual({
      date: "2026-09-01",
      seed: "ate",
      rhymeKey: "EY T",
      before: null,
      after: null,
      heldBefore: false,
      heldAfter: false,
      moved: false,
    });
  });
});

/**
 * The whole approved correction, over a temp supplement and two fixture indexes
 * — the second built with the very lines the first half wrote, which is what the
 * dev server's rebuild does to `dist-data/` between the two reads.
 */
describe("applyCorrection", () => {
  let dir: string;
  let supplementPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rhyme-bee-correction-"));
    supplementPath = join(dir, "supplement.dict");
    writeFileSync(supplementPath, "# a committed supplement\n");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const before = makeTestIndex();
  const ateKey = before.pinSeed("ate").rhymeKey;
  const hatKey = before.pinSeed("hat").rhymeKey;

  const schedule = scheduleOf([
    { date: "2026-09-01", seed: "ate", rhymeKey: ateKey },
    { date: "2026-09-02", seed: "hat", rhymeKey: hatKey },
    { date: "2026-09-03", seed: "bed", rhymeKey: before.pinSeed("bed").rhymeKey },
  ]);

  /** The dev server's own arrangement: `openIndex` answers differently after a rebuild. */
  function deps(joinLines: string) {
    let rebuilt = false;
    const after = makeTestIndex({ supplement: joinLines });
    return {
      context: () => context({ pronunciations: [["gate", [["G", "EY1", "T"]]]], words: ["gate"] }),
      schedule: () => schedule,
      openIndex: () => (rebuilt ? after : before),
      rebuild: async () => {
        rebuilt = true;
        return { ok: true as const };
      },
      supplementPath,
    };
  }

  const joinAsk = {
    word: "gate",
    target: hatKey,
    phonemes: ["G", "AE1", "T"] as Pronunciation,
    mode: "join" as const,
  };

  it("writes the correction to the supplement, comment and alternates included", async () => {
    await applyCorrection(joinAsk, deps(correctionLines({
      word: "gate",
      mode: "join",
      target: hatKey,
      readings: [["G", "EY1", "T"], ["G", "AE1", "T"]],
    })));
    const written = readFileSync(supplementPath, "utf8");
    expect(written).toContain("gate G EY1 T");
    expect(written).toContain("gate(2) G AE1 T");
    expect(written).toContain("joins the engine's reading as an alternate");
  });

  it("rechecks the union of the word's keys before and after", async () => {
    const result = await applyCorrection(joinAsk, deps(correctionLines({
      word: "gate",
      mode: "join",
      target: hatKey,
      readings: [["G", "EY1", "T"], ["G", "AE1", "T"]],
    })));
    expect(result.keysBefore).toEqual([ateKey]);
    expect(result.keysAfter).toEqual([ateKey, hatKey]);
    expect(result.rechecked).toEqual([ateKey, hatKey]);
    // The third day is on neither key and is not rechecked — the whole reason
    // 260 days cost a handful of reads rather than 260.
    expect(result.days.map((day) => day.date)).toEqual(["2026-09-01", "2026-09-02"]);
  });

  it("reports which day moved and which did not", async () => {
    const result = await applyCorrection(joinAsk, deps(correctionLines({
      word: "gate",
      mode: "join",
      target: hatKey,
      readings: [["G", "EY1", "T"], ["G", "AE1", "T"]],
    })));
    const moved = result.days.find((day) => day.date === "2026-09-02")!;
    const unmoved = result.days.find((day) => day.date === "2026-09-01")!;
    expect(moved).toMatchObject({ seed: "hat", heldBefore: false, heldAfter: true, moved: true });
    // The join left the word where it was, which is the point of a join.
    expect(unmoved).toMatchObject({ seed: "ate", heldBefore: true, heldAfter: true, moved: false });
  });

  it("writes one reading for a replace, and reports the key it moved to", async () => {
    const result = await applyCorrection(
      { ...joinAsk, mode: "replace" },
      deps(correctionLines({
        word: "gate",
        mode: "replace",
        target: hatKey,
        readings: [["G", "AE1", "T"]],
      })),
    );
    expect(result.written).toEqual([["G", "AE1", "T"]]);
    expect(result.keysBefore).toEqual([ateKey]);
    expect(result.keysAfter).toEqual([hatKey]);
    expect(readFileSync(supplementPath, "utf8")).not.toContain("gate(2)");
  });

  /**
   * The honest reading, approved off a proposal the add path made and
   * verification refused. There is no reading to join to and no correction being
   * made — the write is the whole of the act, and what it buys is wordhood plus
   * a reading, which is what turns "not a word we know" into "doesn't rhyme".
   */
  it("writes an honest reading for a word the engine reads not at all", async () => {
    let rebuilt = false;
    const result = await applyCorrection(
      { word: "gleeb", target: ateKey, phonemes: ["G", "L", "IY1", "B"], mode: "replace" },
      {
        context: () => context({}),
        schedule: () => schedule,
        openIndex: () => before,
        rebuild: async () => {
          rebuilt = true;
          return { ok: true as const };
        },
        supplementPath,
      },
    );
    expect(rebuilt).toBe(true);
    expect(result.written).toEqual([["G", "L", "IY1", "B"]]);
    expect(result.keysBefore).toEqual([]);
    expect(result.keysAfter).toEqual(["IY B"]);
    expect(readFileSync(supplementPath, "utf8")).toContain("gleeb G L IY1 B");
    // No scheduled day sits on `IY B`, so the recheck reaches nothing — a real
    // outcome rather than an empty one, and what the screen says instead.
    expect(result.days).toEqual([]);
  });

  it("repairs a supplement whose last newline was trimmed rather than fusing onto it", async () => {
    writeFileSync(supplementPath, "# a hand edit that lost its newline\nhat HH AE1 T");
    await applyCorrection(joinAsk, deps(""));
    const lines = readFileSync(supplementPath, "utf8").split("\n");
    expect(lines).toContain("hat HH AE1 T");
    expect(lines).toContain("gate G EY1 T");
  });
});

/** A schedule over the days a test names, with figures nothing here asserts on. */
function scheduleOf(days: { date: string; seed: string; rhymeKey: RhymeKey }[]): Schedule {
  return {
    startDate: days[0]!.date,
    band: { min: 1, max: 500 },
    // The recorded figures are deliberately not the real ones: drift is reported
    // on the readout rather than refusing it, and this suite asserts on movement.
    days: days.map((day) => ({
      ...day,
      weekday: "Tue" as const,
      week: 1,
      answerCount: 1,
      difficulty: 0.1,
    })),
  };
}

/** One built day, narrowed to what `movementOf` reads off it. */
function dayReadout({
  facts,
  answers,
  bonusWords,
}: {
  facts: PuzzleFacts;
  answers: string[];
  bonusWords: string[];
}): ScheduledDayReadout {
  const word = (w: string) => ({ word: w, length: w.length, knownness: 2 });
  return {
    outcome: "day",
    date: "2026-09-01",
    weekday: "Tue",
    week: 1,
    seed: "ate",
    seedRespelling: "ayt",
    rhymeKey: "EY T",
    facts,
    drift: {
      date: "2026-09-01",
      weekday: "Tue",
      seed: "ate",
      rhymeKey: "EY T",
      weekdayBand: null,
      sizeBand: { min: 1, max: 500 },
      recorded: { answerCount: facts.answerCount, difficulty: facts.difficulty },
      recomputed: facts,
      drifted: false,
      reasons: [],
    },
    answers: answers.map(word),
    bonusWords: bonusWords.map(word),
  };
}
