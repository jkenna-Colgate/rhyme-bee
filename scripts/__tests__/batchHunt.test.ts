/**
 * The Batch's ruling list and the Rhyme Index (#322): no rebuild between items,
 * one on demand when a word that was given a reading comes up again, and one at
 * the end of the sitting, after which the Seed Word test runs.
 *
 * The terminal loop is not under test. These are the two things it asks: which
 * index an item is shown on, and what the end of the sitting does.
 */

import { describe, expect, it } from "vitest";
import type { RhymeKey } from "../../src/phonology.ts";
import type { Schedule } from "../../src/schedule.ts";
import { makeTestIndex } from "../../src/__fixtures__/index.ts";
import type { RebuildResult } from "../../web/src/editor/add.ts";
import { rebuildAfterSitting, sittingIndex, type Settled } from "../batchHunt.ts";

const before = makeTestIndex();
const after = makeTestIndex({ supplement: "gate G EY1 T\ngate(2) G AE1 T" });
const ateKey = before.pinSeed("ate").rhymeKey;
const hatKey = before.pinSeed("hat").rhymeKey;

/** A build that counts its runs, and an index that is the new one once it has run. */
function builds(result: RebuildResult = { ok: true }) {
  let runs = 0;
  let built = false;
  return {
    runs: () => runs,
    rebuild: () => {
      runs++;
      if (result.ok) built = true;
      return result;
    },
    loadIndex: () => (built ? after : before),
  };
}

describe("the index a ruling list item is shown on", () => {
  it("is the one the sitting started with, with no rebuild, for a word no reading was written for", () => {
    const build = builds();
    const index = sittingIndex(before, build, () => {});
    index.wroteReading("gate");
    expect(index.showing("hat")).toBe(before);
    expect(build.runs()).toBe(0);
  });

  it("is rebuilt once when a word comes up again after a reading was written for it", () => {
    const build = builds();
    const index = sittingIndex(before, build, () => {});
    index.wroteReading("gate");
    const shown = index.showing("gate");
    expect(shown.readingsOf("gate").map((r) => r.pronunciation.join(" "))).toContain("G AE1 T");
    expect(build.runs()).toBe(1);
    // The rebuild folded in every reading written so far, so neither word asks for another.
    expect(index.showing("gate")).toBe(shown);
    expect(index.showing("hat")).toBe(shown);
    expect(build.runs()).toBe(1);
  });

  it("shows the word on the index it has when the rebuild fails, and says so", () => {
    const build = builds({ ok: false, error: "the Continuity check failed" });
    const said: string[] = [];
    const index = sittingIndex(before, build, (line) => said.push(line));
    index.wroteReading("gate");
    expect(index.showing("gate")).toBe(before);
    expect(said.join("\n")).toContain("the Continuity check failed");
    expect(said.join("\n")).toContain("data/supplement.dict");
    // It would fail the same way again, so the word's next appearance does not try.
    index.showing("gate");
    expect(build.runs()).toBe(1);
  });
});

function scheduleOf(days: { date: string; seed: string; rhymeKey: RhymeKey }[]): Schedule {
  return {
    startDate: days[0]!.date,
    band: { min: 1, max: 500 },
    days: days.map((day) => ({ ...day, weekday: "Tue" as const, week: 1, answerCount: 1, difficulty: 0.1 })),
  };
}

const undecided = (word: string): Settled["item"] => ({
  kind: "undecided",
  rhyme: { word, seedWord: "hat", rhymeKey: hatKey, knew: "overrule", confidence: "high", why: "", heard: null, reading: null },
});

const confirmedGate: Settled = {
  item: undecided("gate"),
  decision: { kind: "confirm", reading: ["G", "AE1", "T"] },
  wrote: "data/supplement.dict: gate G EY1 T; gate G AE1 T",
};
const declined: Settled = { item: undecided("cat"), decision: { kind: "decline" }, wrote: "data/declines.txt: cat AE T" };
const demoted: Settled = { item: undecided("cat"), decision: { kind: "demotion", reason: "proper-noun" }, wrote: "data/demotions.txt: cat proper-noun" };
const tiered: Settled = {
  item: { kind: "tier", untiered: { word: "cat", seedWord: "hat", rhymeKey: hatKey } },
  decision: { kind: "tier", tier: "bonus" },
  wrote: "data/tier-overrides.csv: cat bonus",
};
const unruled: Settled = { item: undecided("gate"), decision: { kind: "unruled" }, wrote: null };

const noSeed = scheduleOf([{ date: "2026-09-01", seed: "ate", rhymeKey: ateKey }]);
const gateDay = scheduleOf([{ date: "2026-09-04", seed: "gate", rhymeKey: ateKey }]);

describe("the rebuild at the end of the sitting", () => {
  it("runs once for a sitting that wrote readings, and the index then holds them", () => {
    const build = builds();
    const end = rebuildAfterSitting([confirmedGate, declined, unruled], { ...build, schedule: noSeed }, () => {});
    expect(build.runs()).toBe(1);
    expect(end.rebuilt).toEqual({ ok: true });
    expect(build.loadIndex().readingsOf("gate").map((r) => r.pronunciation.join(" "))).toContain("G AE1 T");
    expect(end.seedWordLines).toEqual([]);
  });

  it.each([["a Demotion", demoted], ["a Tier verdict", tiered]])("runs for %s, as it did before", (_, ruling) => {
    const build = builds();
    rebuildAfterSitting([ruling], { ...build, schedule: noSeed }, () => {});
    expect(build.runs()).toBe(1);
  });

  it("does not run for a sitting that wrote nothing the index is built from", () => {
    const build = builds();
    const said: string[] = [];
    const end = rebuildAfterSitting([declined, unruled], { ...build, schedule: gateDay }, (line) => said.push(line));
    expect(build.runs()).toBe(0);
    expect(end).toEqual({ rebuilt: null, seedWordLines: [] });
    expect(said).toEqual([]);
  });

  it("runs the Seed Word test on the rebuilt index for a reading written to a scheduled Seed Word", () => {
    const end = rebuildAfterSitting([confirmedGate], { ...builds(), schedule: gateDay }, () => {});
    // Joined, `gate` is heard two ways: on AE T it rhymes with `hat`, which EY T does not.
    expect(end.seedWordLines).toHaveLength(1);
    expect(end.seedWordLines[0]).toContain("2026-09-04, Seed Word gate");
    expect(end.seedWordLines[0]).toContain("seeds:test");
  });

  it("reports a failed rebuild, and that the Seed Word test could not run", () => {
    const build = builds({ ok: false, error: "the Continuity check failed" });
    const end = rebuildAfterSitting([confirmedGate], { ...build, schedule: gateDay }, () => {});
    expect(end.rebuilt).toEqual({ ok: false, error: "the Continuity check failed" });
    expect(end.seedWordLines).toEqual([expect.stringContaining("could not run")]);
  });
});
