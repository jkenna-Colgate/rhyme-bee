/**
 * The Seed Word test run once over the whole Schedule (#264): every day whose
 * Seed Word fails goes through the Continuity repair, and every day whose Seed
 * Word carries its Rhyme Key on a secondary stress is re-seeded in its own
 * family when the ranking holds a word on the main stress.
 */

import { describe, expect, it } from "vitest";
import { makeTestIndex } from "../__fixtures__/index.ts";
import type { ScheduleDay } from "../schedule.ts";
import { runSeedWordTest } from "../seedWordRun.ts";

const index = makeTestIndex({
  pronunciations: [
    ["makeup", [["M", "EY1", "K", "AH2", "P"]]],
    ["cup", [["K", "AH1", "P"]]],
    ["pup", [["P", "AH1", "P"]]],
  ],
  words: ["makeup", "cup", "pup"],
  prevalence: [["makeup", 2.5], ["cup", 2.0], ["pup", 1.6]],
});

function day(date: string, seed: string, rhymeKey: string): ScheduleDay {
  return { date, weekday: "Mon", week: 1, seed, rhymeKey, answerCount: 0, difficulty: 0 };
}

describe("the run over the Schedule", () => {
  it("leaves a day whose Seed Word passes and carries the main stress exactly as it was", () => {
    const days = [day("2026-09-07", "ate", "EY T")];
    const run = runSeedWordTest(days, index);
    expect(run.days).toEqual(days);
    expect(run.changes).toEqual([]);
  });

  it("re-seeds a secondary-stress Seed Word in its own family, keeping its key and place", () => {
    const run = runSeedWordTest([day("2026-10-22", "makeup", "AH P")], index);
    expect(run.days[0]).toMatchObject({ date: "2026-10-22", seed: "cup", rhymeKey: "AH P" });
    expect(run.changes).toEqual([
      expect.objectContaining({ date: "2026-10-22", why: "re-ranked", before: expect.objectContaining({ seed: "makeup" }) }),
    ]);
  });

  it("keeps a secondary-stress Seed Word when the family's only main-stress words are inflections", () => {
    const takings = makeTestIndex({
      pronunciations: [
        ["take", [["T", "EY1", "K"]]],
        ["taking", [["T", "EY1", "K", "IH0", "NG"]]],
        ["breathtaking", [["B", "R", "EH1", "TH", "T", "EY2", "K", "IH0", "NG"]]],
      ],
      words: ["take", "taking", "breathtaking"],
      prevalence: [["take", 2.5], ["taking", 2.5], ["breathtaking", 2.0]],
    });
    const days = [day("2026-11-03", "breathtaking", "EY K AH NG")];
    const run = runSeedWordTest(days, takings);
    expect(run.days).toEqual(days);
    expect(run.changes).toEqual([]);
  });

  it("does not re-seed onto a word another day holds as its Seed Word", () => {
    // Two days on one key is #228's one-place collision, reported elsewhere;
    // the re-seed does not add a second one by taking `cup`.
    const run = runSeedWordTest([day("2026-10-01", "cup", "AH P"), day("2026-10-22", "makeup", "AH P")], index);
    expect(run.days[1]).toMatchObject({ seed: "pup", rhymeKey: "AH P" });
  });

  it("names the part of the test a failing Seed Word failed", () => {
    const run = runSeedWordTest([day("2026-09-07", "objurgate", "EY T"), day("2026-09-08", "tear", "IH R")], index);
    expect(run.changes.map((c) => [c.date, c.why, c.after.seed])).toEqual([
      ["2026-09-07", "not-an-answer", "ate"],
      ["2026-09-08", "not-heard-one-way", "beer"],
    ]);
  });
});
