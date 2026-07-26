/**
 * Builds a RhymeIndex over the mini fixtures. This fixture IS the pinned data
 * for the test suite, so it is the source of truth for the verdicts below — the
 * tests assert verdicts, never the mechanism that produces them.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCmudict } from "../cmudict.ts";
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
]);

export const KNOWNNESS_THRESHOLD = 1.0;

export function makeTestIndex(): RhymeIndex {
  const data: RhymeIndexData = {
    pronunciations: parseCmudict(cmudictText),
    words,
    names,
    prevalence,
  };
  return new RhymeIndex(data, { knownnessThreshold: KNOWNNESS_THRESHOLD });
}

export function makeTestData(): RhymeIndexData {
  return {
    pronunciations: parseCmudict(cmudictText),
    words,
    names,
    prevalence,
  };
}
