/**
 * Builds a RhymeIndex over the mini fixtures. This fixture IS the pinned data
 * for the test suite, so it is the source of truth for the verdicts below — the
 * tests assert verdicts, never the mechanism that produces them.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCmudict } from "../cmudict.ts";
import { applyNormalisation } from "../normalise.ts";
import { RhymeIndex, type RhymeIndexData } from "../rhymeIndex.ts";

const cmudictText = readFileSync(
  fileURLToPath(new URL("./mini.cmudict", import.meta.url)),
  "utf8",
);

/** Common English words (lower-cased). Wordhood gate — excludes names. */
const words = new Set<string>([
  "ate", "eight", "late", "collate", "impregnate", "adjudicate",
  "defenestrate", "objurgate", "chocolate", "commensurate", "hat",
  "read", "bed", "tear", "beer", "care", "gate", "gates", "plates",
  // The `-ate` guardrails: `chocolate` and `commensurate` above, plus the rest
  // of the set ADR-0001 rejected "final syllable, stress ignored" over.
  "private", "climate", "senate", "accurate",
  // The cot-caught merger and its pre-rhotic exclusion (ADR-0010).
  "docked", "talked", "walked", "balked", "stalked", "hawked",
  "ball", "doll", "for", "far", "born", "barn", "cord", "card",
  // `sate` is a real word we deliberately leave out of the prevalence data,
  // to exercise the absent-from-knownness -> Bonus default (ADR-0003).
  "sate",
  // `grates` is a real word we deliberately leave out of CMUdict: it passes
  // the wordhood gate but has no pronunciation, exercising the truthful
  // no-pronunciation verdict (a player hears it rhyming with `plates`, but the
  // engine has nothing to rhyme-test) — issue #28.
  "grates",
]);

/** Names, used only to label a rejection as a Proper Noun. */
const names = new Set<string>(["kate"]);

/**
 * Word-prevalence scores (lemma -> knownness), on the Brysbaert z-scale. The
 * threshold is 1.0. `objurgate` sits below it (Bonus); `defenestrate` above it
 * (Answer) — the ADR-0003 assumption made into data. `gates` is absent on
 * purpose: its lemma `gate` carries the score.
 */
const prevalence = new Map<string, number>([
  ["ate", 2.5], ["eight", 2.5], ["late", 2.5], ["collate", 1.8],
  ["impregnate", 1.6], ["adjudicate", 1.7], ["defenestrate", 1.5],
  ["objurgate", 0.2], ["chocolate", 2.5], ["commensurate", 1.2],
  ["hat", 2.5], ["read", 2.5], ["bed", 2.5], ["tear", 2.5],
  ["beer", 2.5], ["care", 2.5], ["gate", 2.4], ["plates", 2.4],
  ["private", 2.5], ["climate", 2.5], ["senate", 2.4], ["accurate", 2.4],
  ["docked", 2.0], ["talked", 2.5], ["walked", 2.5], ["balked", 1.6],
  ["stalked", 1.9], ["hawked", 1.5], ["ball", 2.5], ["doll", 2.4],
  ["for", 2.5], ["far", 2.5], ["born", 2.5], ["barn", 2.4],
  ["cord", 2.4], ["card", 2.5],
]);

export const KNOWNNESS_THRESHOLD = 1.0;

export function makeTestIndex(): RhymeIndex {
  return buildTestIndex(makeTestData());
}

/**
 * The raw inputs, as the index build sees them before any stage has run — the
 * fixture's stand-in for the pinned upstream files. A test that exercises a
 * build stage starts here, applies the stage, then calls `buildTestIndex`.
 */
export function makeTestData(): RhymeIndexData {
  return {
    pronunciations: parseCmudict(cmudictText),
    words,
    names,
    prevalence,
  };
}

/**
 * The tail of the real index build: normalise the readings (ADR-0010), then
 * construct. Tests go through here rather than calling `new RhymeIndex` so the
 * verdicts they assert are the verdicts `npm run build:index` would produce.
 */
export function buildTestIndex(data: RhymeIndexData): RhymeIndex {
  applyNormalisation(data);
  return new RhymeIndex(data, { knownnessThreshold: KNOWNNESS_THRESHOLD });
}
