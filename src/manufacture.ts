/**
 * Manufacture: pinned text in, index data out.
 *
 * The build turns the pinned inputs into readings in a fixed order — demotions,
 * then the committed supplement, then coverage derivation, then normalisation —
 * and that order is load-bearing. Demotions run first so every later stage reads
 * a corrected word list rather than working around it. A hand-authored reading
 * must beat a composed one, so the supplement precedes coverage. And every
 * reading must reach the accent specification as an *input* rather than an
 * exemption, so normalisation runs last (ADR-0010, ADR-0011).
 *
 * That order used to live in comments in the build script, with each stage
 * taking a mutable target it would happily accept twice or out of turn. Here it
 * is expressed once, inside one call, and cannot be spelled wrongly from
 * outside: a caller hands over text and receives finished data. Parsing the
 * upstream formats is part of the job for the same reason — a caller that parsed
 * first would be back to holding the pieces in the right order.
 *
 * The four stages stay separately testable through their own modules. This owns
 * the order, not the rules.
 */

import { parseCmudict } from "./cmudict.ts";
import { applyCoverage, type DerivedWord } from "./coverage.ts";
import { applyDemotions, type AppliedDemotion } from "./demotions.ts";
import { applyNormalisation } from "./normalise.ts";
import { parsePrevalenceCsv, parseWordList } from "./pipeline.ts";
import type { RhymeIndexData } from "./rhymeIndex.ts";
import { applySupplement } from "./supplement.ts";

/**
 * The pinned inputs, as text, exactly as they sit in `data/`. Text rather than
 * parsed structures because parsing is one of the steps this owns.
 */
export interface PinnedInputs {
  /** CMUdict, in its own format. */
  cmudict: string;
  /** The wordhood word list, one per line. */
  words: string;
  /** The names list, one per line — used only to label a Proper Noun rejection. */
  names: string;
  /** The word-prevalence norms, as CSV (ADR-0003). */
  prevalence: string;
  /** The committed demotion list (#90). Empty text is a legitimate no-op. */
  demotions: string;
  /** The committed human override layer (ADR-0009). Likewise. */
  supplement: string;
}

/** A CMUdict surface form that will never be a valid Submission, and why. */
export interface DroppedWord {
  word: string;
  reason: "proper-noun" | "not-in-word-list";
}

/**
 * The finished index data, plus the three reports the build publishes. They are
 * returned as values because each is evidence about a stage that ran in here:
 * assembling them outside would mean the caller re-deriving what the order
 * already knows.
 */
export interface ManufacturedIndex {
  /** What `new RhymeIndex(...)` is constructed from. */
  data: RhymeIndexData;
  /** Every word the demotion list took wordhood from (#90). */
  demoted: AppliedDemotion[];
  /** Every word coverage derivation gave a reading to, and the rule (#76). */
  derived: DerivedWord[];
  /** Every pronounced surface form the wordhood gate excludes (story 40). */
  dropped: DroppedWord[];
}

export function manufactureIndexData(inputs: PinnedInputs): ManufacturedIndex {
  const pronunciations = parseCmudict(inputs.cmudict);
  const words = parseWordList(inputs.words);
  const names = parseWordList(inputs.names);
  const prevalence = parsePrevalenceCsv(inputs.prevalence);

  // 1. Demotions, *first*, so every stage below reads a corrected word list: the
  // upstream wordhood list carries surnames and placenames, and the gate tests
  // wordhood before name-hood, so `algiers` was being served as an ordinary
  // Answer. Running here also means the supplement's standing refusal to launder
  // a name into a word covers demoted names too. See src/demotions.ts.
  const demoted = applyDemotions(inputs.demotions, { words, names });

  // 2. The committed human override layer (ADR-0009), merged over the pinned
  // upstream inputs: it adds missing words (with a reading) and corrects
  // mis-marked stress, and — unlike everything else in data/ — survives rebuild.
  applySupplement(inputs.supplement, { pronunciations, words, names });

  // 3. Tier 1 coverage (issue #76): a known word with no reading is given one,
  // composed from a stem the build already reads. *After* the supplement, so a
  // hand-authored reading always beats a composed one, and it supplies readings
  // only — never wordhood. See src/coverage.ts.
  const derived = applyCoverage({ pronunciations, words, names, prevalence });

  // 4. The accent specification (ADR-0010), applied to every reading before any
  // Rhyme Key is computed. *Last*, so a hand-authored or derived reading is an
  // input to the accent rather than an exemption from it. See src/normalise.ts.
  applyNormalisation({ pronunciations });

  // Dropped-words report (story 40), read off the finished state: every CMUdict
  // surface form that will never be a valid Submission, so over-aggressive
  // filtering is visible. It has to be taken after demotions, which is why it
  // belongs here and not in the caller.
  const dropped: DroppedWord[] = [];
  for (const word of pronunciations.keys()) {
    if (words.has(word)) continue;
    dropped.push({ word, reason: names.has(word) ? "proper-noun" : "not-in-word-list" });
  }
  dropped.sort((a, b) => a.word.localeCompare(b.word));

  return { data: { pronunciations, words, names, prevalence }, demoted, derived, dropped };
}
