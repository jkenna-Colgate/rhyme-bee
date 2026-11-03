/**
 * The Answers that only Normalisation puts on a day's Rhyme Key (#296; ADR-0021,
 * 2026-11-02 amendment). The trial that scores the Judge on them is tested in
 * `scripts/__tests__/judgeTrial.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { appendedOnlyAnswers, reachesKeyOnlyByAppended } from "../appendedReadings.ts";
import type { Pronunciation } from "../phonology.ts";

const r = (s: string): Pronunciation => s.split(" ");
const source = (s: string) => ({ pronunciation: r(s), generated: false });
const appended = (s: string) => ({ pronunciation: r(s), generated: true });

describe("reachesKeyOnlyByAppended", () => {
  it("holds for a word whose only reading on the key Normalisation appended (`annual` for `cool` before the fix)", () => {
    expect(reachesKeyOnlyByAppended([source("AE1 N Y UW0 AH0 L"), appended("AE1 N Y UW2 L")], ["UW L"])).toBe(true);
  });

  it("does not hold when a reading a source transcribed reaches the key as well (`module`)", () => {
    expect(reachesKeyOnlyByAppended([source("M AA1 JH UW0 L"), source("M AA1 JH UW2 L"), appended("M AA1 JH AH0 L")], ["UW L"])).toBe(false);
  });

  it("does not hold for a word with no reading on the key at all", () => {
    expect(reachesKeyOnlyByAppended([source("F UW1 D")], ["UW L"])).toBe(false);
  });

  it("reads the merged keys as the key: a source reading on the Schwa Twin keeps the word out", () => {
    const keys = ["EH K SH AH N", "EH K SH N"];
    expect(reachesKeyOnlyByAppended([source("S AH1 B S EH2 K SH N")], keys)).toBe(false);
    expect(reachesKeyOnlyByAppended([source("IH0 N S EH1 K SH AH0 N"), appended("IH0 N S EH1 K SH N")], keys)).toBe(false);
  });

  it("and an appended reading on the Schwa Twin, with nothing from a source on either key, puts it in", () => {
    expect(reachesKeyOnlyByAppended([source("K AH1 M EH0 K SH AH0 N"), appended("K AH1 M EH2 K SH N")], ["EH K SH AH N", "EH K SH N"])).toBe(true);
  });
});

describe("appendedOnlyAnswers", () => {
  const READINGS: Record<string, ReturnType<typeof source>[]> = {
    annual: [source("AE1 N Y UW0 AH0 L"), appended("AE1 N Y UW2 L")],
    manual: [source("M AE1 N Y UW0 AH0 L"), appended("M AE1 N Y UW2 L")],
    module: [source("M AA1 JH UW0 L"), source("M AA1 JH UW2 L")],
    pool: [source("P UW1 L")],
  };

  it("picks the day's Answers on the key only through appended readings, once each, in alphabetical order", () => {
    const got = appendedOnlyAnswers(["pool", "manual", "module", "annual", "manual"], ["UW L"], (w) => READINGS[w] ?? []);
    expect(got).toEqual(["annual", "manual"]);
  });
});
