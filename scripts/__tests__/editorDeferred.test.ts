/**
 * Slice: the Candidate Queue's second section (#181) — the readings the add path
 * asked an agent for and did not get, read back from the file that has only ever
 * been written to.
 *
 * Two seams, both here: the file's **format**, over text rather than a disk, and
 * the **section**, over records and an evidence context that arrive as
 * arguments. Nothing under test opens a file — `web/__tests__/deferredFile.test.ts`
 * is where a real one does, including the empty and the missing case — and
 * nothing shells out to an agent. What is asserted is the state a caller gets
 * back through the interface, never how it was derived.
 */

import { describe, expect, it } from "vitest";
import { makeTestData } from "../../src/__fixtures__/index.ts";
import type { Pronunciation } from "../../src/phonology.ts";
import { evidenceContextFrom, type EvidenceContext } from "../../src/supplementEvidence.ts";
import {
  parseDeferredReadings,
  readDeferredSection,
  type DeferredRecord,
} from "../editorDeferred.ts";

/** `docked`'s key in the fixture. */
const DOCKED = "AA K T";
/** The fixture's widest family. */
const ATE = "EY T";

interface Extra {
  pronunciations?: [string, Pronunciation[]][];
  words?: string[];
}

/**
 * The fixture's pinned inputs as an evidence context, Normalisation applied the
 * way the index build applies it — `editorCandidates.test.ts`'s own helper, for
 * its reason: the `answered` check is the engine's, and simulating it here would
 * be testing a simulation.
 */
function contextFor(extra: Extra = {}): EvidenceContext {
  const raw = makeTestData();
  for (const [word, prons] of extra.pronunciations ?? []) raw.pronunciations.set(word, prons);
  for (const word of extra.words ?? []) raw.words.add(word);
  return evidenceContextFrom({
    pronunciations: raw.pronunciations,
    words: raw.words,
    names: raw.names,
  });
}

/** One record on file, defaulting to the unreachable-agent case. */
function record(over: Partial<DeferredRecord> = {}): DeferredRecord {
  return {
    word: "zorp",
    rhymeKey: DOCKED,
    reason: "agent-unavailable",
    proposed: null,
    timestamp: "2026-08-12T21:00:00.000Z",
    ...over,
  };
}

/** One line of the file, as `appendToDeferredQueue` writes it. */
function line(fields: Record<string, unknown>): string {
  return JSON.stringify(fields);
}

describe("the deferred file's format", () => {
  it("reads back a word the agent could not be reached for", () => {
    const parsed = parseDeferredReadings(
      line({
        word: "zorp",
        rhymeKey: DOCKED,
        reason: "agent-unavailable",
        proposed: null,
        timestamp: "2026-08-12T21:00:00.000Z",
      }) + "\n",
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.word).toBe("zorp");
    expect(parsed[0]!.reason).toBe("agent-unavailable");
    expect(parsed[0]!.proposed).toBeNull();
  });

  it("carries the reading a proposal was refused for, so it can be judged later", () => {
    const parsed = parseDeferredReadings(
      line({
        word: "zorp",
        rhymeKey: DOCKED,
        reason: "agent-reading-failed-verification",
        proposed: ["Z", "AO1", "R", "P"],
        timestamp: "2026-08-12T21:00:00.000Z",
      }),
    );

    expect(parsed[0]!.proposed).toEqual(["Z", "AO1", "R", "P"]);
  });

  // Every line written before #181 is this shape: the outcome carried the
  // refused reading and the append dropped it.
  it("reads a line with no reading on it as one with nothing proposed", () => {
    const parsed = parseDeferredReadings(
      line({
        word: "zorp",
        rhymeKey: DOCKED,
        reason: "agent-reading-failed-verification",
        timestamp: "2026-08-12T21:00:00.000Z",
      }),
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.proposed).toBeNull();
  });

  it("drops a line that will not read, keeping the records either side of it", () => {
    const parsed = parseDeferredReadings(
      [
        line({ ...record(), word: "first" }),
        "{not json at all",
        "",
        line({ ...record(), word: "second" }),
      ].join("\n"),
    );

    expect(parsed.map((r) => r.word)).toEqual(["first", "second"]);
  });

  it("drops a line that reads but is not a deferral", () => {
    const parsed = parseDeferredReadings(
      [
        line({ ...record(), rhymeKey: "aa k t" }),
        line({ ...record(), reason: "the-agent-was-rude" }),
        line({ ...record(), word: "" }),
        line({ ...record(), timestamp: undefined }),
        "[]",
      ].join("\n"),
    );

    expect(parsed).toEqual([]);
  });

  // The deferral is the record; the reading is a field on it. A garbled reading
  // costs the judgement, not the knowledge that the word was deferred at all.
  it("keeps a record whose proposed reading is not ARPABET, without the reading", () => {
    const parsed = parseDeferredReadings(
      line({
        ...record(),
        reason: "agent-reading-failed-verification",
        proposed: ["Z", 7, "zorp"],
      }),
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.proposed).toBeNull();
  });

  // The add path's own parser is the gate (`parseReading`), so what the file
  // will read back is exactly what the add path would have written: a token
  // longer than an ARPABET symbol is not one, however much it looks like one.
  it("refuses a reading whose tokens are not the shape the add path writes", () => {
    const refused = [
      ["Z", "AORP1", "R", "P"],
      ["Z", "ao1", "R", "P"],
      ["Z AO1 R P"],
    ];

    for (const proposed of refused) {
      const parsed = parseDeferredReadings(
        line({ ...record(), reason: "agent-reading-failed-verification", proposed }),
      );

      expect(parsed).toHaveLength(1);
      expect(parsed[0]!.proposed).toBeNull();
    }
  });

  it("answers an empty file with no records", () => {
    expect(parseDeferredReadings("")).toEqual([]);
    expect(parseDeferredReadings("\n\n")).toEqual([]);
  });
});

describe("the deferred section", () => {
  it("offers a word the agent was not reached for as outstanding, with nothing to judge", () => {
    const section = readDeferredSection([record()], contextFor());

    expect(section.entries).toHaveLength(1);
    expect(section.entries[0]!.state).toBe("unreached");
    expect(section.outstanding).toBe(1);
  });

  it("offers a refused reading as a proposal, carrying the reading itself", () => {
    const proposed: Pronunciation = ["Z", "AO1", "R", "P"];
    const section = readDeferredSection(
      [record({ reason: "agent-reading-failed-verification", proposed })],
      contextFor(),
    );

    const [entry] = section.entries;
    expect(entry!.state === "proposed" && entry!.proposed).toEqual(proposed);
    expect(section.outstanding).toBe(1);
  });

  it("has nothing to judge when a refused reading was never recorded", () => {
    const section = readDeferredSection(
      [record({ reason: "agent-reading-failed-verification", proposed: null })],
      contextFor(),
    );

    expect(section.entries[0]!.state).toBe("unreached");
  });

  // The one state nobody writes: a landed retry and an approved honest reading
  // are both "the engine reads this word now", which is derived on every read.
  it("answers a deferral whose word the engine reads now, with no ruling on it", () => {
    const section = readDeferredSection([record({ word: "docked" })], contextFor());

    const [entry] = section.entries;
    expect(entry!.state).toBe("answered");
    expect(entry!.state === "answered" && entry!.readings.map((r) => r.key)).toEqual([DOCKED]);
    expect(section.outstanding).toBe(0);
  });

  it("answers a deferral whose reading now misses the key it was aimed at", () => {
    // The honest-reading case after approval: the word reads, and it reads
    // somewhere other than the target. The add is answered either way.
    const section = readDeferredSection([record({ word: "eight" })], contextFor());

    expect(section.entries[0]!.state).toBe("answered");
    expect(section.outstanding).toBe(0);
  });

  // The file is append-only, so a word deferred twice is two lines.
  it("shows one entry per word and Rhyme Key, and the later line wins", () => {
    const section = readDeferredSection(
      [
        record({ reason: "agent-unavailable", timestamp: "2026-08-11T09:00:00.000Z" }),
        record({
          reason: "agent-reading-failed-verification",
          proposed: ["Z", "AO1", "R", "P"],
          timestamp: "2026-08-12T21:00:00.000Z",
        }),
      ],
      contextFor(),
    );

    expect(section.entries).toHaveLength(1);
    expect(section.entries[0]!.state).toBe("proposed");
    expect(section.entries[0]!.record.timestamp).toBe("2026-08-12T21:00:00.000Z");
  });

  // The entry renders the word as the engine reads it, so the identity has to
  // be that word too: keyed on the raw field, `Zorp` and `zorp` would be one
  // ask shown twice, under one React key.
  it("takes two lines differing only in case as one ask", () => {
    const section = readDeferredSection(
      [
        record({ word: "Zorp", timestamp: "2026-08-11T09:00:00.000Z" }),
        record({
          word: "zorp",
          reason: "agent-reading-failed-verification",
          proposed: ["Z", "AO1", "R", "P"],
          timestamp: "2026-08-12T21:00:00.000Z",
        }),
      ],
      contextFor(),
    );

    expect(section.entries).toHaveLength(1);
    expect(section.entries[0]!.word).toBe("zorp");
    expect(section.entries[0]!.state).toBe("proposed");
    expect(section.outstanding).toBe(1);
  });

  it("keeps one word deferred against two Rhyme Keys as two asks", () => {
    const section = readDeferredSection(
      [record({ rhymeKey: DOCKED }), record({ rhymeKey: ATE })],
      contextFor(),
    );

    expect(section.entries.map((e) => e.rhymeKey)).toEqual([DOCKED, ATE]);
    expect(section.outstanding).toBe(2);
  });

  it("answers an empty file with an empty section rather than a failure", () => {
    expect(readDeferredSection([], contextFor())).toEqual({ entries: [], outstanding: 0 });
  });
});
