/**
 * Slice: the Candidate Queue read as a value (#177). This is the seam that
 * carries the behaviour — the state union, the Rhyme Key grouping, the day
 * match, the orphan groups and the derived resolution — and everything above it
 * renders what it returns.
 *
 * Every case is over the fixture's own pinned inputs with nothing read from
 * disk, following `editorDay.test.ts`'s shape: the evidence context arrives as
 * an argument, so the module can be asked about a queue that exists only in this
 * file. What is asserted is what a caller can observe through the interface —
 * the state a Candidate comes back in — never how that state was derived.
 */

import { describe, expect, it, vi } from "vitest";
import { makeTestData } from "../../src/__fixtures__/index.ts";
import type { Decline } from "../../src/declines.ts";
import type { Pronunciation } from "../../src/phonology.ts";
import type { Schedule } from "../../src/schedule.ts";
import type { SupplementCandidate } from "../../src/supplementCandidate.ts";
import { evidenceContextFrom, type EvidenceContext } from "../../src/supplementEvidence.ts";
import { readCandidateQueue, type CandidateQueueReadout } from "../editorCandidates.ts";

/**
 * `node:fs`'s write surface, replaced for the whole file.
 *
 * "Nothing is written" is the claim this slice makes loudest, and an assertion
 * that cannot fail does not carry it. Nothing under test opens a file, so a call
 * that lands here is the defect rather than a side effect worth passing through
 * — the stubs are deliberately inert, which means a regression is caught instead
 * of performed against the real `data/`.
 */
const fsWrites = vi.hoisted(() => ({
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  writeFile: vi.fn(),
  appendFile: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const mocked = {
    ...actual,
    writeFileSync: fsWrites.writeFileSync,
    appendFileSync: fsWrites.appendFileSync,
    promises: {
      ...actual.promises,
      writeFile: fsWrites.writeFile,
      appendFile: fsWrites.appendFile,
    },
  };
  return { ...mocked, default: mocked };
});

/** `docked`'s key in the fixture, and the family the cot–caught Appeals aimed at. */
const DOCKED = "AA K T";
/** The fixture's widest family. */
const ATE = "EY T";

/**
 * A two-day run: one day on the `ate` family, one on the `shellshocked` family
 * whose Rhyme Key is `docked`'s. Every other key a Candidate names below is
 * deliberately absent from it, which is the 17-of-33 case.
 */
const SCHEDULE: Schedule = {
  startDate: "2026-09-01",
  band: { min: 1, max: 500 },
  days: [
    { date: "2026-09-01", weekday: "Tue", week: 1, seed: "ate", rhymeKey: ATE, answerCount: 12, difficulty: 0.3 },
    { date: "2026-09-02", weekday: "Wed", week: 1, seed: "shellshocked", rhymeKey: DOCKED, answerCount: 9, difficulty: 0.4 },
  ],
};

interface Extra {
  pronunciations?: [string, Pronunciation[]][];
  words?: string[];
  names?: string[];
}

/**
 * The fixture's pinned inputs as an evidence context, Normalisation applied the
 * way the index build applies it — which is what makes the cot–caught merger
 * live here rather than something this test has to simulate.
 */
function contextFor(extra: Extra = {}): EvidenceContext {
  const raw = makeTestData();
  for (const [word, prons] of extra.pronunciations ?? []) raw.pronunciations.set(word, prons);
  for (const word of extra.words ?? []) raw.words.add(word);
  for (const name of extra.names ?? []) raw.names.add(name);
  return evidenceContextFrom({
    pronunciations: raw.pronunciations,
    words: raw.words,
    names: raw.names,
  });
}

let jotted = 0;

/** One captured Candidate, with a timestamp that increases in capture order. */
function candidate(
  word: string,
  seedWord: string,
  seedRhymeKey: string,
  over: Partial<SupplementCandidate> = {},
): SupplementCandidate {
  jotted += 1;
  return {
    word,
    seedWord,
    seedRhymeKey,
    reason: "does-not-rhyme",
    engineRespelling: null,
    timestamp: new Date(Date.UTC(2026, 7, 1, 12, 0, 0) + jotted * 60_000).toISOString(),
    ...over,
  };
}

/** The one Candidate a readout holds, when a case puts exactly one on the queue. */
function only(readout: CandidateQueueReadout) {
  expect(readout.groups).toHaveLength(1);
  expect(readout.groups[0]!.candidates).toHaveLength(1);
  return readout.groups[0]!.candidates[0]!;
}

describe("a Candidate whose word now rhymes", () => {
  it("comes back resolved, with the readings that reach the key", () => {
    const read = only(
      readCandidateQueue([candidate("talked", "docked", DOCKED)], SCHEDULE, [], contextFor()),
    );

    expect(read.state).toBe("resolved");
    expect(read.state === "resolved" && read.readings.map((r) => r.key)).toContain(DOCKED);
  });

  /**
   * The regression the whole feature exists to stop recurring. These five were
   * fixed when the cot–caught merger landed in Normalisation and have been
   * carried as outstanding work ever since, because clearing the queue was a
   * manual archive step nobody ran. Pinned by name.
   */
  it("retires the five cot–caught Candidates on first render", () => {
    const words = ["talked", "hawked", "walked", "balked", "stalked"];
    const readout = readCandidateQueue(
      words.map((word) => candidate(word, "docked", DOCKED)),
      SCHEDULE,
      [],
      contextFor(),
    );

    expect(readout.groups).toHaveLength(1);
    expect(readout.groups[0]!.candidates.map((c) => [c.word, c.state])).toEqual(
      words.map((word) => [word, "resolved"]),
    );
    expect(readout.outstanding).toBe(0);
    expect(readout.groups[0]!.outstanding).toBe(0);
  });

  it("records no Decline for it, and writes nothing at all", () => {
    for (const write of Object.values(fsWrites)) write.mockClear();

    // Resolution is derived: the only file this feature ever writes is the
    // Declines file, a resolved Candidate does not reach it, and slice 2 is what
    // writes it in any case. Run the whole union rather than the resolved case
    // alone — the claim is about the function, not about one branch of it.
    const readout = readCandidateQueue(
      [
        candidate("walked", "docked", DOCKED),
        candidate("chocolate", "docked", DOCKED),
        candidate("eight", "docked", DOCKED),
        candidate("grates", "ate", ATE),
      ],
      SCHEDULE,
      [{ word: "chocolate", rhymeKey: DOCKED }],
      contextFor(),
    );

    expect(readout.total).toBe(4);
    for (const [name, write] of Object.entries(fsWrites)) {
      expect(write, `node:fs ${name} was called`).not.toHaveBeenCalled();
    }
  });

  it("is not resolved by rhyming alone when the word has no wordhood", () => {
    // Reads `AA K T` and rhymes, but the wordhood gate refuses it — so the
    // player is still being told no, and the Candidate still wants an add.
    const read = only(
      readCandidateQueue(
        [candidate("bawked", "docked", DOCKED)],
        SCHEDULE,
        [],
        contextFor({ pronunciations: [["bawked", [["B", "AO1", "K", "T"]]]] }),
      ),
    );

    expect(read.state).toBe("addable");
    expect(read.state === "addable" && read.readings.map((r) => r.key)).toEqual([DOCKED]);
  });
});

describe("grouping by Rhyme Key", () => {
  it("groups two Seed Words' Candidates together and lands them on that key's day", () => {
    const readout = readCandidateQueue(
      [
        candidate("undocked", "docked", DOCKED),
        candidate("outwalked", "shellshocked", DOCKED),
      ],
      SCHEDULE,
      [],
      contextFor(),
    );

    expect(readout.groups).toHaveLength(1);
    const group = readout.groups[0]!;
    expect(group.rhymeKey).toBe(DOCKED);
    expect(group.seedWords).toEqual(["docked", "shellshocked"]);
    expect(group.candidates.map((c) => c.word)).toEqual(["undocked", "outwalked"]);
    expect(group.day).toEqual({ date: "2026-09-02", weekday: "Wed", week: 1, seed: "shellshocked" });
  });

  it("gives a key the schedule does not hold a group of its own, with no day", () => {
    const readout = readCandidateQueue(
      [candidate("overjoy", "joy", "OY"), candidate("undocked", "docked", DOCKED)],
      SCHEDULE,
      [],
      contextFor(),
    );

    expect(readout.groups.map((g) => g.rhymeKey).sort()).toEqual([DOCKED, "OY"]);
    expect(readout.groups.find((g) => g.rhymeKey === "OY")!.day).toBeNull();
    expect(readout.total).toBe(2);
  });

  it("counts what is outstanding per group and over the whole queue", () => {
    const readout = readCandidateQueue(
      [
        candidate("talked", "docked", DOCKED),
        candidate("undocked", "docked", DOCKED),
        candidate("grates", "ate", ATE),
      ],
      SCHEDULE,
      [],
      contextFor(),
    );

    const docked = readout.groups.find((g) => g.rhymeKey === DOCKED)!;
    expect(docked.candidates).toHaveLength(2);
    expect(docked.outstanding).toBe(1);
    expect(readout.outstanding).toBe(2);
  });

  it("sinks a fully worked group below one that still wants a ruling", () => {
    const readout = readCandidateQueue(
      [
        // `AA K T` is the earlier-dated day, and is entirely resolved.
        candidate("talked", "docked", DOCKED),
        candidate("grates", "ate", ATE),
      ],
      { ...SCHEDULE, days: [SCHEDULE.days[1]!, SCHEDULE.days[0]!] },
      [],
      contextFor(),
    );

    expect(readout.groups.map((g) => g.rhymeKey)).toEqual([ATE, DOCKED]);
  });
});

describe("a standing Decline", () => {
  const declines: Decline[] = [{ word: "chocolate", rhymeKey: DOCKED }];

  it("declines the Candidate it names", () => {
    const read = only(
      readCandidateQueue([candidate("chocolate", "docked", DOCKED)], SCHEDULE, declines, contextFor()),
    );

    expect(read.state).toBe("declined");
  });

  it("declines it only for the Rhyme Key it was declined against", () => {
    const readout = readCandidateQueue(
      [candidate("chocolate", "docked", DOCKED), candidate("chocolate", "ate", ATE)],
      SCHEDULE,
      declines,
      contextFor(),
    );

    const byKey = new Map(readout.groups.map((g) => [g.rhymeKey, g.candidates[0]!]));
    expect(byKey.get(DOCKED)!.state).toBe("declined");
    // The same word, the same file, a different target — and still outstanding.
    expect(byKey.get(ATE)!.state).toBe("needs-correction");
  });

  /**
   * The one state a Decline is the *only* way out of. A demotion does not change
   * the names data the evidence is read from, so a name Candidate left below the
   * name branch would read `is-a-name` on every render for ever, already ruled
   * on and unable to say so. Pinned because the ordering it depends on is not
   * visible from any other case.
   */
  it("settles a name Candidate, which no other gesture can", () => {
    const read = only(
      readCandidateQueue(
        [candidate("stockholm", "docked", DOCKED)],
        SCHEDULE,
        [{ word: "stockholm", rhymeKey: DOCKED }],
        contextFor({
          pronunciations: [["stockholm", [["S", "T", "AA1", "K", "T"]]]],
          words: ["stockholm"],
          names: ["stockholm"],
        }),
      ),
    );

    expect(read.state).toBe("declined");
  });

  it("is overtaken by a word that has since started rhyming", () => {
    const read = only(
      readCandidateQueue(
        [candidate("talked", "docked", DOCKED)],
        SCHEDULE,
        [{ word: "talked", rhymeKey: DOCKED }],
        contextFor(),
      ),
    );

    expect(read.state).toBe("resolved");
  });
});

describe("the ruling a Candidate's evidence asks for", () => {
  it("is a name when the word is in the names data, however well it rhymes", () => {
    // `stockholm` is given a reading that rhymes on the target *and* wordhood,
    // which is the shape the demotion list exists for: the engine accepts it
    // today, and a name is never valid (CONTEXT.md).
    const read = only(
      readCandidateQueue(
        [candidate("stockholm", "docked", DOCKED, { reason: "does-not-rhyme" })],
        SCHEDULE,
        [],
        contextFor({
          pronunciations: [["stockholm", [["S", "T", "AA1", "K", "T"]]]],
          words: ["stockholm"],
          names: ["stockholm"],
        }),
      ),
    );

    expect(read.state).toBe("is-a-name");
  });

  it("is a correction when the engine reads the word on another key", () => {
    const read = only(
      readCandidateQueue([candidate("eight", "docked", DOCKED)], SCHEDULE, [], contextFor()),
    );

    expect(read.state).toBe("needs-correction");
    expect(read.state === "needs-correction" && read.readings.map((r) => r.key)).toEqual([ATE]);
  });

  it("is an add when the word has no reading, and offers its relatives", () => {
    const read = only(
      readCandidateQueue(
        [candidate("overjoy", "joy", "OY")],
        SCHEDULE,
        [],
        contextFor({
          pronunciations: [["overjoyed", [["OW2", "V", "ER0", "JH", "OY1", "D"]]]],
          words: ["overjoy", "overjoyed"],
        }),
      ),
    );

    expect(read.state).toBe("addable");
    if (read.state !== "addable") throw new Error("expected an addable Candidate");
    // The correction card's evidence and the derivation card's are mutually
    // exclusive by `gatherEvidence`'s own construction, and stay so here.
    expect(read.readings).toEqual([]);
    expect(read.relatives.map((r) => r.word)).toEqual(["overjoyed"]);
  });

  it("is an add carrying a composed reading when a compound split reaches the key", () => {
    const read = only(
      readCandidateQueue([candidate("ballwalked", "docked", DOCKED)], SCHEDULE, [], contextFor()),
    );

    expect(read.state).toBe("addable");
    if (read.state !== "addable") throw new Error("expected an addable Candidate");
    expect(read.composed?.key).toBe(DOCKED);
    expect(read.composed?.head.word).toBe("ball");
    expect(read.composed?.tail.word).toBe("walked");
  });

  it("is an add with nothing to offer when the word has wordhood and no reading", () => {
    // `grates` is in the fixture's word list and in no dictionary it reads.
    const read = only(
      readCandidateQueue([candidate("grates", "ate", ATE)], SCHEDULE, [], contextFor()),
    );

    expect(read.state).toBe("addable");
    if (read.state !== "addable") throw new Error("expected an addable Candidate");
    expect(read.readings).toEqual([]);
    expect(read.relatives).toEqual([]);
    expect(read.composed).toBeNull();
  });
});

describe("the readout as a whole", () => {
  it("carries the captured record beside every state, unaltered", () => {
    const jot = candidate("undocked", "docked", DOCKED, {
      reason: "not-a-known-word",
      engineRespelling: null,
    });
    const read = only(readCandidateQueue([jot], SCHEDULE, [], contextFor()));

    expect(read.candidate).toEqual(jot);
    expect(read.word).toBe("undocked");
  });

  it("names the queue's newest timestamp, so a stale list does not read as empty", () => {
    const readout = readCandidateQueue(
      [
        candidate("undocked", "docked", DOCKED, { timestamp: "2026-07-01T09:00:00.000Z" }),
        candidate("eight", "ate", ATE, { timestamp: "2026-08-09T21:30:00.000Z" }),
        candidate("grates", "ate", ATE, { timestamp: "2026-08-02T10:00:00.000Z" }),
      ],
      SCHEDULE,
      [],
      contextFor(),
    );

    expect(readout.newest).toBe("2026-08-09T21:30:00.000Z");
  });

  it("answers an empty queue with no groups and no timestamp", () => {
    expect(readCandidateQueue([], SCHEDULE, [], contextFor())).toEqual({
      groups: [],
      total: 0,
      outstanding: 0,
      newest: null,
      // The second section (#181) is read from a file of its own and defaults
      // to none, so a caller asking about Candidates alone gets an empty one.
      // What it holds when there *is* one is `editorDeferred.test.ts`'s.
      deferred: { entries: [], outstanding: 0 },
    });
  });

  it("carries the deferred readings through as the queue's second section", () => {
    const readout = readCandidateQueue([], SCHEDULE, [], contextFor(), [
      {
        word: "zorp",
        rhymeKey: DOCKED,
        reason: "agent-unavailable",
        proposed: null,
        timestamp: "2026-08-12T21:00:00.000Z",
      },
    ]);

    expect(readout.deferred.entries.map((d) => [d.word, d.state])).toEqual([["zorp", "unreached"]]);
    expect(readout.deferred.outstanding).toBe(1);
    // A deferred reading is not a Candidate: it was never Appealed, and the
    // queue's own counts do not move for one.
    expect(readout.total).toBe(0);
    expect(readout.outstanding).toBe(0);
  });
});
