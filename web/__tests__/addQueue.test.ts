/**
 * The add queue, which is the whole of what "costing nothing until Submit"
 * means in code: a `string[]` in the browser, and two pure functions over it.
 *
 * These are the assertions that hold the ticket's own promise — a word can be
 * queued, a word can be taken back out before it costs anything, and a word that
 * would waste a batch is refused at the moment it is typed rather than a whole
 * Submit later.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_QUEUED_WORDS,
  aimClash,
  aimHeldFor,
  queueAdd,
  unqueueAdd,
} from "../src/editor/add.ts";

/** Queue a run of words, asserting each one lands. */
function queueAll(words: string[]): string[] {
  let queue: string[] = [];
  for (const word of words) {
    const asked = queueAdd(queue, word);
    if (!asked.ok) throw new Error(`${word} was refused: ${asked.error}`);
    queue = asked.queue;
  }
  return queue;
}

describe("queueing a word", () => {
  it("keeps the words in the order they were typed", () => {
    expect(queueAll(["candleholder", "abstract", "bust"])).toEqual([
      "candleholder",
      "abstract",
      "bust",
    ]);
  });

  it("normalises the way the endpoint and the file's parsers do", () => {
    expect(queueAll(["  CandleHolder  "])).toEqual(["candleholder"]);
  });

  it("leaves the standing queue untouched when it refuses", () => {
    const queue = queueAll(["bust"]);
    const asked = queueAdd(queue, "bust");

    expect(asked.ok).toBe(false);
    expect(queue).toEqual(["bust"]);
  });

  it("refuses a word already queued rather than judging it twice", () => {
    const asked = queueAdd(queueAll(["bust"]), "BUST");

    expect(asked).toEqual({ ok: false, error: "bust is already queued." });
  });

  /**
   * A typo with a stray character in it would reach the endpoint, be refused
   * there, and take the rest of the batch down with it. Refusing at the keypress
   * is what keeps the promise that a mistake costs nothing.
   */
  it("refuses anything that is not a word, in letters", () => {
    for (const typed of ["", "   ", "counter-thrust", "bust!", "b2st", "two words"]) {
      expect(queueAdd([], typed).ok).toBe(false);
    }
  });

  it("refuses the word past the cap, and says what to do instead", () => {
    // Distinct words made of letters alone, since that is all the queue takes.
    const full = queueAll(Array.from({ length: MAX_QUEUED_WORDS }, (_, n) => "w" + "a".repeat(n + 1)));
    expect(full).toHaveLength(MAX_QUEUED_WORDS);

    const asked = queueAdd(full, "onemore");
    expect(asked.ok).toBe(false);
    expect(asked.ok === false && asked.error).toMatch(/Submit these/);
  });
});

describe("taking a word back out", () => {
  it("removes the word by name and keeps the rest in order", () => {
    expect(unqueueAdd(queueAll(["candleholder", "abstract", "bust"]), "abstract")).toEqual([
      "candleholder",
      "bust",
    ]);
  });

  it("leaves a queue that never held the word alone", () => {
    expect(unqueueAdd(queueAll(["bust"]), "abstract")).toEqual(["bust"]);
  });
});

/**
 * A queue is bound to one aim, and this is the assertion that the binding is
 * what stops a batch landing on a Rhyme Key nothing on screen named.
 *
 * There are two aims — a day, whose key the endpoint resolves from the date, and
 * a Rhyme Key a Candidate supplied outright (#178) — and `aimClash` is the one
 * rule that says which words may join which queue. `useAdder` gates queueing on
 * it and `AddQueueView` shuts the entry on it; both read this one function.
 */
describe("what a queue is aimed at", () => {
  const monday = { kind: "day", date: "2026-08-10" } as const;
  const tuesday = { kind: "day", date: "2026-08-11" } as const;
  const docked = { kind: "key", rhymeKey: "AA K T" } as const;

  it("refuses a word typed against another day, and names the day to go back to", () => {
    const clash = aimClash(monday, tuesday);
    expect(clash).not.toBeNull();
    expect(clash).toContain(monday.date);
  });

  it("takes a word typed against the day the queue is already aimed at", () => {
    expect(aimClash(monday, monday)).toBeNull();
  });

  /**
   * An empty queue is aimed at nothing, which is what lets an editor who has just
   * submitted — or emptied the queue by hand — start a fresh one wherever they
   * are, rather than being sent back to a day they have finished with.
   */
  it("takes anything when the queue is aimed at nothing", () => {
    expect(aimClash(null, tuesday)).toBeNull();
    expect(aimClash(null, docked)).toBeNull();
  });

  /**
   * The two aims do not mix. A word typed on a day cannot join a batch raised
   * from the Candidate Queue, and the sentence names the key it is aimed at
   * rather than a date, because there may be no date — most Candidates belong to
   * no scheduled day at all.
   */
  it("refuses a typed word against a queue raised from the Candidate Queue", () => {
    const clash = aimClash(docked, monday);
    expect(clash).not.toBeNull();
    expect(clash).toContain(docked.rhymeKey);
  });

  it("takes a second Candidate on the same Rhyme Key", () => {
    expect(aimClash(docked, { kind: "key", rhymeKey: "AA K T" })).toBeNull();
    expect(aimClash(docked, { kind: "key", rhymeKey: "AA K" })).not.toBeNull();
  });
});

/**
 * Submit asks a narrower question than queueing does. What stops a day-aimed
 * queue being submitted from another day is not that the aim would be wrong —
 * the aim travels with the request — but that the answer re-reads the day it
 * wrote to and would replace the screen with a day the editor was not looking
 * at. A key-aimed queue re-reads nothing of the sort, so nothing holds it.
 */
describe("when a queue may be submitted", () => {
  const monday = "2026-08-10";
  const tuesday = "2026-08-11";

  it("holds a day-aimed queue on any other day, and names the day to go back to", () => {
    const held = aimHeldFor({ kind: "day", date: monday }, tuesday);
    expect(held).not.toBeNull();
    expect(held).toContain(monday);
  });

  it("lets a day-aimed queue act on the day it was typed against", () => {
    expect(aimHeldFor({ kind: "day", date: monday }, monday)).toBeNull();
  });

  it("holds nothing when the queue is aimed at nothing", () => {
    expect(aimHeldFor(null, tuesday)).toBeNull();
  });

  /**
   * The property that makes the one-gesture add reach the whole queue. Most
   * Candidates belong to no scheduled day, so a Submit gate that asked which day
   * they were on could only ever answer "not this one" — the words would be
   * queueable and never submittable, which is the failure #178's first
   * acceptance criterion is about.
   */
  it("holds a queue raised from the Candidate Queue on no day at all", () => {
    expect(aimHeldFor({ kind: "key", rhymeKey: "AA K T" }, monday)).toBeNull();
    expect(aimHeldFor({ kind: "key", rhymeKey: "AA K T" }, tuesday)).toBeNull();
  });
});
