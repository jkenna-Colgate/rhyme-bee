/**
 * The Candidate the Editor's Pass records when the index holds a word on a
 * Rhyme Key other than the day's (#163).
 *
 * Two claims are worth testing and one is not. The field-by-field shaping is
 * trivial and would be a test that restates it; what is not trivial is that the
 * report **is a report the existing endpoint accepts**, and that the respelling
 * it carries is **the engine's own**. So every case here goes through something
 * that already existed: `candidateFromReport` is the exact validator both
 * `web/supplementPlugin.ts` and `web/worker/appealRoute.ts` apply, and
 * `RhymeIndex.adjudicate` is asked what respelling it would have shown a player
 * rather than being taken at its documented word.
 *
 * Nothing here introduces a queue, a record shape or an endpoint: the record is
 * `SupplementCandidate`, and the only thing under test is the browser filling it
 * in from an add outcome.
 */

import { describe, expect, it } from "vitest";
import { makeTestIndex, makeTestData } from "../../src/__fixtures__/index.ts";
import { rhymeKeyOf } from "../../src/phonology.ts";
import { respell } from "../../src/respelling.ts";
import {
  MAX_REPORT_BYTES,
  candidateFromReport,
  serialiseCandidate,
} from "../../src/supplementCandidate.ts";
import { evidenceContextFrom, gatherEvidence } from "../../src/supplementEvidence.ts";
import {
  disagreementKey,
  disagreementReport,
  failureFor,
} from "../src/editor/disagreement.ts";

/** The fixture's widest family, and the day the editor is imagined to be on. */
const SEED = "ate";
const SEED_KEY = "EY T";

/**
 * A word the fixture's own CMUdict reads on `EY T S` — so it is in the index, on
 * a key that is not the day's, which is the whole precondition of this slice. It
 * is a real fixture entry rather than an injected one, so the readings under test
 * are the ones a build actually produces.
 */
const HELD_ELSEWHERE = "plates";

/**
 * A word given two readings on two different keys, neither of them the day's.
 * Injected rather than found, because the fixture holds no such word and the
 * order of a two-reading list is the one thing worth being sure of here.
 */
const TWO_READINGS: [string, string[][]] = [
  "bluebeard",
  [
    ["B", "L", "UW1", "B", "IH2", "R", "D"],
    ["B", "L", "UW1", "B", "ER0", "D"],
  ],
];

/** The evidence an add gathers for one word against the day's key. */
function readingsFor(word: string, extra?: [string, string[][]]) {
  const raw = makeTestData();
  if (extra) {
    raw.pronunciations.set(extra[0], extra[1]);
    raw.words.add(extra[0]);
  }
  const context = evidenceContextFrom({
    pronunciations: raw.pronunciations,
    words: raw.words,
    names: raw.names,
  });
  return gatherEvidence(word, SEED_KEY, context);
}

describe("the disagreement recorded for a word held on another key", () => {
  it("carries the word, the Seed Word, the Seed's Rhyme Key and the does-not-rhyme reason", () => {
    const evidence = readingsFor(HELD_ELSEWHERE);
    expect(evidence.direct.length).toBeGreaterThan(0);
    expect(evidence.rhymesDirectly).toBe(false);

    const report = disagreementReport(HELD_ELSEWHERE, evidence.direct, SEED, SEED_KEY);

    expect(report.word).toBe(HELD_ELSEWHERE);
    expect(report.seedWord).toBe(SEED);
    expect(report.seedRhymeKey).toBe(SEED_KEY);
    expect(report.reason).toBe("does-not-rhyme");
    // Exactly the five fields the endpoint recognises. A sixth would be refused
    // whole rather than trimmed, so the count is the assertion.
    expect(Object.keys(report).sort()).toEqual(
      ["engineRespelling", "reason", "seedRhymeKey", "seedWord", "word"],
    );
  });

  /**
   * The claim the whole record turns on. `engineRespelling` is defined as *the
   * reading the engine used*, and the engine's own `does-not-rhyme` verdict
   * respells `prons[0]`. If the add's evidence and the index's pronunciation
   * list ever fell out of step — a different order, a different Normalisation —
   * the Candidate would carry a reading nobody was ever shown, and would look
   * exactly as correct as it does now.
   */
  it("records the respelling the engine would have shown a player who submitted it", () => {
    const index = makeTestIndex();
    const verdict = index.adjudicate(index.pinSeed(SEED, SEED_KEY), HELD_ELSEWHERE);
    expect(verdict).toMatchObject({ outcome: "rejected", reason: "does-not-rhyme" });

    const report = disagreementReport(
      HELD_ELSEWHERE,
      readingsFor(HELD_ELSEWHERE).direct,
      SEED,
      SEED_KEY,
    );

    expect(report.engineRespelling).toBe(
      (verdict as { respelling?: string }).respelling,
    );
  });

  /**
   * The same claim where it can actually fail. A word with one reading agrees
   * with the engine whichever reading either side picks; a word with two only
   * agrees if the add's evidence and the index's pronunciation list are in the
   * *same order*, which is the property this pair of readings is chosen to
   * expose — they respell differently, so picking the wrong one is visible.
   */
  it("agrees with the engine on which reading is the used one, when there are two", () => {
    const [word, prons] = TWO_READINGS;
    const index = makeTestIndex({ pronunciations: [[word, prons]], words: [word] });
    const verdict = index.adjudicate(index.pinSeed(SEED, SEED_KEY), word);
    expect(verdict).toMatchObject({ outcome: "rejected", reason: "does-not-rhyme" });

    const evidence = readingsFor(word, TWO_READINGS);
    const report = disagreementReport(word, evidence.direct, SEED, SEED_KEY);

    expect(report.engineRespelling).toBe((verdict as { respelling?: string }).respelling);
    // The two readings do not respell alike, so the assertion above had a way
    // to fail.
    expect(respell(evidence.direct[0]!.phonemes)).not.toBe(
      respell(evidence.direct[1]!.phonemes),
    );
  });

  /**
   * A word the index holds twice records one respelling — the first, because
   * that is the one the engine uses — while the screen is left to name every key
   * it is held on. The two readings here are on different keys, so a report that
   * picked the second would be pointing the judge at a reading no player would
   * ever have been shown.
   */
  it("records the first reading when the index holds more than one", () => {
    const [word] = TWO_READINGS;
    const evidence = readingsFor(word, TWO_READINGS);

    expect(evidence.direct).toHaveLength(2);
    expect(evidence.direct[0]!.key).not.toBe(evidence.direct[1]!.key);
    expect(evidence.rhymesDirectly).toBe(false);

    const report = disagreementReport(word, evidence.direct, SEED, SEED_KEY);

    expect(report.engineRespelling).toBe(respell(evidence.direct[0]!.phonemes));
    expect(rhymeKeyOf(evidence.direct[0]!.phonemes)).not.toBe(SEED_KEY);
  });

  it("returns a null respelling when there are no readings at all", () => {
    // Not a state `reads-on-another-key` can reach — it is produced only when the
    // word has a direct reading — so this pins the empty case's answer rather
    // than a case the flow produces.
    const report = disagreementReport("nothing", [], SEED, SEED_KEY);
    expect(report.engineRespelling).toBeNull();
  });
});

describe("the report the existing endpoint is sent", () => {
  /**
   * The acceptance criterion, checked against the validator itself: the six
   * fields the recorded Candidate must carry, five of them from the report and
   * the timestamp from the endpoint. `candidateFromReport` is what both the
   * dev plugin and the deployed Worker route call, so a report it accepts is a
   * report the queue accepts.
   */
  it("is accepted, and lands all six fields of the Candidate", () => {
    const report = disagreementReport(
      HELD_ELSEWHERE,
      readingsFor(HELD_ELSEWHERE).direct,
      SEED,
      SEED_KEY,
    );
    const stamped = "2026-08-09T22:15:00.000Z";

    const outcome = candidateFromReport(report, stamped);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.candidate).toEqual({
      word: HELD_ELSEWHERE,
      seedWord: SEED,
      seedRhymeKey: SEED_KEY,
      reason: "does-not-rhyme",
      engineRespelling: report.engineRespelling,
      timestamp: stamped,
    });
    expect(outcome.candidate.engineRespelling).not.toBeNull();
  });

  /**
   * The body cap is 1024 bytes and the deployed route refuses anything past it
   * without reading further. A disagreement is five short fields, but the
   * respelling is the one that grows with the word, so the worst case is worth
   * measuring rather than assuming: the longest word the validator will take is
   * 45 letters, and a respelling of one is under the 120 it allows.
   */
  it("fits the endpoint's body cap at the longest word it would accept", () => {
    const long = "a".repeat(45);
    const report = disagreementReport(long, [], long, "AH N T EY SH AH N");
    const body = JSON.stringify({
      ...report,
      engineRespelling: "AH-buh-kuh-duh-buh-ruh-tuh-nuh-suh-luh-muh-nuh",
    });

    expect(Buffer.byteLength(body, "utf8")).toBeLessThan(MAX_REPORT_BYTES);
  });

  /**
   * The record reaches the queue in the same serialisation a player's Appeal
   * does — one JSON Lines record — which is what lets one judging pass read
   * both without knowing which end wrote which.
   */
  it("serialises as one line of the same queue a player's Appeal reaches", () => {
    const outcome = candidateFromReport(
      disagreementReport(HELD_ELSEWHERE, readingsFor(HELD_ELSEWHERE).direct, SEED, SEED_KEY),
      "2026-08-09T22:15:00.000Z",
    );
    if (!outcome.ok) throw new Error(outcome.error);

    const line = serialiseCandidate(outcome.candidate);

    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line.trim())).toEqual(outcome.candidate);
  });
});

/**
 * What the screen remembers, and for how long. Both of these were bugs: the set
 * of recorded disagreements was keyed on the word alone, and the failure banner
 * was a bare sentence that outlived the Puzzle it was about.
 *
 * They are pure functions rather than a rendered hook because `web/` has no
 * React test harness, and that shaped the design rather than merely surviving
 * it: `failureFor` is a render-time predicate, not an effect on the date, so the
 * rule is reachable from here at all.
 */
describe("what makes one disagreement distinct from another", () => {
  /**
   * The bug. Record `bluebeard` on the `beard` day, meet it again on a later
   * Puzzle, and keyed on the word alone the button was already gone — replaced
   * by a sentence naming the new Seed Word about a record that had never been
   * made against it. A genuinely different claim, unrecordable and misdescribed.
   */
  it("keys on the Seed Word as well as the word", () => {
    const recorded = new Set([disagreementKey("bluebeard", "beard")]);

    expect(recorded.has(disagreementKey("bluebeard", "beard"))).toBe(true);
    expect(recorded.has(disagreementKey("bluebeard", "bust"))).toBe(false);
  });

  it("keeps two words on one Seed Word apart", () => {
    expect(disagreementKey("bluebeard", "beard")).not.toBe(disagreementKey("weird", "beard"));
  });

  /**
   * The separator is a space because neither end can contain one: the word comes
   * back from the endpoint, which refuses anything but `^[a-z]+$`, and the Seed
   * Word comes out of `data/schedule.json` already in that shape. So no two
   * pairs can collide by running into each other — which is the claim that makes
   * a string key safe here at all.
   */
  it("cannot be made to collide by two pairs running into each other", () => {
    expect(disagreementKey("blue", "beardbust")).not.toBe(disagreementKey("bluebeard", "bust"));
    // Asked of the validator itself rather than asserted: a word with a space in
    // it never comes back from the endpoint, so it never reaches a key.
    const spaced = { ...disagreementReport("bluebeard", [], SEED, SEED_KEY), word: "blue beard" };
    expect(candidateFromReport(spaced, "2026-08-09T22:15:00.000Z").ok).toBe(false);
  });
});

describe("the failure sentence, and the Puzzle it belongs to", () => {
  const FAILED = { message: "The supplement-candidate endpoint answered 500.", seedWord: "beard" };

  it("shows over the readout it was posted from", () => {
    expect(failureFor(FAILED, "beard")).toBe(FAILED.message);
  });

  /**
   * The bug: a post that failed on one day left its banner standing over the
   * next day's readout, telling the editor nothing was recorded about words they
   * had never tried to record.
   */
  it("is silent over a readout about another Seed Word", () => {
    expect(failureFor(FAILED, "bust")).toBeNull();
  });

  it("is silent when there is no failure, and when there is no Puzzle to compare", () => {
    expect(failureFor(null, "beard")).toBeNull();
    expect(failureFor(FAILED, null)).toBeNull();
  });
});
