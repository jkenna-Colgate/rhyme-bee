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
import { MAX_QUEUED_WORDS, aimHeldFor, queueAdd, unqueueAdd } from "../src/editor/add.ts";

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
 * The queue is bound to the day it was typed against, and this is the assertion
 * that the binding is what stops a batch landing on another day's Rhyme Key.
 *
 * The aim is resolved server-side from the date Submit sends, so nothing in the
 * request itself can tell Monday's words apart from Tuesday's — the browser is
 * the only layer that knows which day they were typed on, and `aimHeldFor` is
 * where it says so. `useAdder` gates queueing *and* Submit on it, and
 * `AddQueueView` disables both controls; all three read this one function.
 */
describe("the day a queue is aimed at", () => {
  const monday = "2026-08-10";
  const tuesday = "2026-08-11";

  it("holds a queue typed against another day, and names the day to go back to", () => {
    const held = aimHeldFor(monday, tuesday);
    expect(held).not.toBeNull();
    expect(held).toContain(monday);
  });

  it("lets a queue act on the day it was typed against", () => {
    expect(aimHeldFor(monday, monday)).toBeNull();
  });

  /**
   * An empty queue is bound to no day, which is what lets an editor who has just
   * submitted — or emptied the queue by hand — start a fresh one wherever they
   * are, rather than being sent back to a day they have finished with.
   */
  it("holds nothing when the queue is bound to no day", () => {
    expect(aimHeldFor(null, tuesday)).toBeNull();
  });
});
