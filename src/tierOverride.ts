/**
 * The Retrieval override layer (ADR-0015): the committed file that lets the
 * puzzles editor set any word's **Tier** by name, over the measured word
 * prevalence the split is otherwise drawn from (ADR-0003).
 *
 * Prevalence measures **recognition** — the proportion of surveyed people who
 * report knowing a string when shown it. The game needs **Retrieval**: whether a
 * player, given a Seed Word, will *produce* the word from nothing. For most
 * vocabulary the two track each other closely enough that the difference never
 * surfaces. On transparent prefix compounds they come apart maximally, and as a
 * *ranking inversion* rather than a miscalibrated line — the data ranks
 * `misadjust` (0.8149) above `readjust` (0.7638), and no threshold anywhere on
 * the scale reorders two words. A per-word lever is the only instrument that can
 * express this, which is what this file is.
 *
 * Like the pronunciation supplement it is permanent infrastructure rather than a
 * patch (ADR-0009): any prevalence source will get some words wrong for this
 * game's purposes, because the game needs a quantity no such source measures.
 *
 * This module is the whole of the layer's *rules* — the verdicts and the values
 * they compile to, the parse, the serialise, the last-wins resolution, the
 * multi-row flag, the merge over a prevalence map, and the guard the build runs.
 * It is pure: the file IO, the build wiring and the editor that writes the rows
 * live elsewhere, so none of them can spell the format differently.
 */

import { normaliseWord } from "./cmudict.ts";
import { splitCsvRow } from "./pipeline.ts";
import { isRare, type ScoringConfig } from "./scoring.ts";
import { tierFor, type Tier } from "./verdict.ts";

/**
 * What the editor decided about a word. Three verdicts set a Tier; `none`
 * withdraws a previous one.
 *
 * `none` is not a synonym for `answer-common`, and the distinction is the whole
 * reason it exists. "Undoing" an override with `answer-common` would pin the
 * word to +3.0, silently stripping the rare bonus from a word that measured
 * below the cutoff — the editor would believe they had reverted, and would be
 * wrong.
 */
export type TierVerdict = "bonus" | "answer-rare" | "answer-common" | "none";

/** The three verdicts that patch a value. `none` patches nothing, by definition. */
export type PatchingVerdict = Exclude<TierVerdict, "none">;

/**
 * What each verdict compiles to, fixed by ADR-0015.
 *
 * The layer carries **numbers rather than verdicts** deliberately. Storing the
 * verdict directly is the more theoretically honest design and was rejected so
 * that the tiering path stays single: one type means the Tier reader, the rarity
 * test, the per-Answer scorer and the answer measurer are all untouched, and the
 * override cannot introduce a second tiering path that drifts from the first.
 *
 * These are **not free parameters**. `bonus` and `answer-common` sit outside the
 * observed data range (-2.11 to +2.58) deliberately. `0.6` is boxed — the Answer
 * threshold below it, `rareKnownnessCutoff` (0.7) above — so it has no wide
 * margin: it clears a threshold nudge to 0.5 and is covered by `checkTierSentinels`
 * on the other side. The cost of storing numbers is that a verdict's meaning
 * depends on where two knobs sit, and that guard is how the cost is paid.
 */
export const VERDICT_VALUE: Record<PatchingVerdict, number> = {
  bonus: -3.0,
  "answer-rare": 0.6,
  "answer-common": 3.0,
};

/** One line of the file: what was decided about one word, and when. */
export interface TierOverrideRow {
  word: string;
  verdict: TierVerdict;
  /**
   * What prevalence said at the moment of the judgement, or null when the word
   * had no prevalence row at all.
   *
   * An **audit trail, not a training set**. It records what the data said when
   * the editor disagreed with it, and keeps *lemmatiser coverage gaps* (no row —
   * a coverage problem) separable from *genuine disagreements with the data*
   * (`counterthrust` at 1.2119 — ADR-0015's problem). Those are different
   * populations with different remedies. Plotting these values and sliding the
   * threshold to fit would return the editor's own opinion wearing a number:
   * overrides never calibrate the threshold.
   */
  measured: number | null;
  /** When the judgement was made (ISO 8601). */
  decided: string;
  /** Whatever the editor wanted to say about it. Free text, may be empty. */
  note: string;
}

/** The column header the file carries, and the order the columns are written in. */
export const TIER_OVERRIDE_HEADER = "word,verdict,measured,decided,note";

const VERDICTS: readonly string[] = ["bonus", "answer-rare", "answer-common", "none"];

const COLUMNS = 5;

/**
 * Read a value back to the verdict that produced it, or null when it is an
 * ordinary measured prevalence rather than one of this layer's sentinels.
 *
 * The build never needs this — it patches values and forgets. It is here for the
 * readouts, which show the editor what they decided on an earlier visit.
 */
export function verdictForValue(value: number): PatchingVerdict | null {
  for (const verdict of Object.keys(VERDICT_VALUE) as PatchingVerdict[]) {
    if (VERDICT_VALUE[verdict] === value) return verdict;
  }
  return null;
}

/**
 * Serialise one row as a single newline-terminated line, ready to append.
 *
 * The note is flattened to one line. CSV proper allows a newline inside a quoted
 * field, but this file is read line-by-line and appended to a line at a time, so
 * a row that spanned two lines would be a row the parser could not read back —
 * and it is written by a browser, where a note is whatever the editor typed.
 * Flattening keeps serialise and parse inverses of each other, which is the
 * property the whole append-only design rests on.
 */
export function serialiseTierOverride(row: TierOverrideRow): string {
  const fields = [
    row.word,
    row.verdict,
    row.measured === null ? "" : String(row.measured),
    row.decided,
    row.note.replace(/\r?\n/g, " "),
  ];
  return fields.map(csvField).join(",") + "\n";
}

/**
 * Parse the file into every row it holds, in file order — *not* collapsed.
 * Resolution is `resolveTierOverrides`'s job, because the readout needs to know
 * that a word carries several rows and the build only needs the last one.
 *
 * A malformed row **throws** rather than being skipped, on the reasoning the
 * demotion list is parsed by: a row quietly dropped would leave a word sitting
 * at exactly the Tier this file exists to correct, which is the defect rather
 * than a graceful degradation of it. The file is machine-written, so a row that
 * does not parse means something upstream is wrong and should be loud.
 */
export function parseTierOverrides(text: string): TierOverrideRow[] {
  const out: TierOverrideRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;

    const fields = splitCsvRow(line);
    // The header, whether or not the file has been rewritten since. No real row
    // can collide: `verdict` is not one of the verdicts.
    if (fields[0]?.trim() === "word" && fields[1]?.trim() === "verdict") continue;

    if (fields.length !== COLUMNS) {
      throw new Error(
        `Tier override "${line}": expected ${COLUMNS} columns (${TIER_OVERRIDE_HEADER}), found ${fields.length}.`,
      );
    }

    const verdict = fields[1]!.trim();
    if (!VERDICTS.includes(verdict)) {
      throw new Error(
        `Tier override "${line}": "${verdict}" is not a verdict. Expected one of ${VERDICTS.join(", ")}.`,
      );
    }

    const rawMeasured = fields[2]!.trim();
    const measured = rawMeasured === "" ? null : Number(rawMeasured);
    if (measured !== null && Number.isNaN(measured)) {
      throw new Error(
        `Tier override "${line}": measured is "${rawMeasured}", which is neither a prevalence ` +
          `nor empty. Empty means the word had no prevalence row, which is a different fact.`,
      );
    }

    out.push({
      word: normaliseWord(fields[0]!),
      verdict: verdict as TierVerdict,
      measured,
      decided: fields[3]!.trim(),
      note: fields[4]!,
    });
  }
  return out;
}

/** A word's standing verdict, and how many rows it took to get there. */
export interface ResolvedOverride extends TierOverrideRow {
  /** How many rows this word carries. More than one means it was reversed. */
  rows: number;
}

/**
 * Resolve the file to one standing verdict per word, **last row wins**.
 *
 * The file is append-only: a word may appear many times and the build takes the
 * last. Appending cannot corrupt what is already written, whereas rewriting a
 * row opens a crash window over a file that can never be regenerated. History is
 * preserved and the reversal record is itself evidence — which is why the row
 * count travels with the verdict, so a readout can flag a reversal rather than
 * letting it be invisible.
 */
export function resolveTierOverrides(rows: TierOverrideRow[]): Map<string, ResolvedOverride> {
  const resolved = new Map<string, ResolvedOverride>();
  for (const row of rows) {
    const seen = resolved.get(row.word)?.rows ?? 0;
    resolved.set(row.word, { ...row, rows: seen + 1 });
  }
  return resolved;
}

/** The part of the index build's data this stage touches. Mutated. */
export interface TierOverrideTarget {
  /** The measured prevalence map, patched in place. */
  prevalence: Map<string, number>;
}

/** One word's override as applied, so the build can report what the layer did. */
export interface AppliedTierOverride {
  word: string;
  verdict: TierVerdict;
  /** The value written, or null for a `none` — which withdraws rather than sets. */
  patched: number | null;
  /** How many rows the word carries; more than one is a reversal. */
  rows: number;
  /** Whether the prevalence data held the word before the patch. */
  hadPrevalence: boolean;
}

/**
 * Merge the layer over the parsed prevalence map.
 *
 * Runs at index-build time, **before any Tier is read**, so no adjudication code
 * learns that overrides exist. An override is **global across a word's Rhyme
 * Keys**: it patches the word's prevalence, and Retrieval is a property of a
 * word rather than of a family — a word a player cannot retrieve cannot be
 * retrieved on either of its keys.
 *
 * A `none` patches nothing at all. It does not write a value, and it does not
 * remove one: it withdraws the override and leaves prevalence governing, which
 * for a word that never had a prevalence row means leaving it without one.
 *
 * Empty text is a legitimate no-op, as an empty demotion list is.
 */
export function applyTierOverrides(
  text: string,
  target: TierOverrideTarget,
): AppliedTierOverride[] {
  const applied: AppliedTierOverride[] = [];
  for (const [word, override] of resolveTierOverrides(parseTierOverrides(text))) {
    const hadPrevalence = target.prevalence.has(word);
    const patched = override.verdict === "none" ? null : VERDICT_VALUE[override.verdict];
    if (patched !== null) target.prevalence.set(word, patched);
    applied.push({ word, verdict: override.verdict, patched, rows: override.rows, hadPrevalence });
  }
  return applied;
}

// --- the build-time guard ------------------------------------------------------

/** The two knobs a sentinel's meaning hangs on. */
export interface TierKnobs {
  /** The Answer/Bonus line: a word tiers to Answer when its value clears this. */
  knownnessThreshold: number;
  /** The scoring configuration, which owns the rare line. */
  scoring: ScoringConfig;
}

/** One sentinel that no longer means what it was chosen to mean. */
export interface SentinelFault {
  verdict: PatchingVerdict;
  /** The value that verdict compiles to. */
  value: number;
  /** What it was chosen to produce, in words. */
  expected: string;
  /** What it produces now. */
  actual: string;
  /** Which knob moved out from under it. */
  knob: "knownnessThreshold" | "rareKnownnessCutoff";
}

/**
 * Assert each sentinel still yields the Tier and rarity it was chosen for.
 *
 * This is the price of storing numbers rather than verdicts. A verdict's meaning
 * depends on where two knobs sit, so a knob moved without a thought for this
 * layer would silently re-tier every word the editor ever judged — `answer-rare`
 * quietly becoming an ordinary Answer, or a Bonus Word quietly becoming an
 * Answer. The risk is not eliminated, it is made **loud**: the build runs this
 * and fails on a non-empty result.
 *
 * It asks the engine's own two functions — `tierFor` for the Answer/Bonus line
 * and `isRare` for the rare one — rather than restating either rule. That is
 * load-bearing rather than tidy: a guard carrying its own copy of a comparison
 * would keep passing if the comparison itself changed, leaving a blind spot at
 * exactly the point the guard exists to be loud about. Sharing the functions
 * means the only thing that can move underneath a sentinel is a knob's value,
 * which is the thing being checked.
 */
export function checkTierSentinels(knobs: TierKnobs): SentinelFault[] {
  const faults: SentinelFault[] = [];
  for (const verdict of Object.keys(VERDICT_VALUE) as PatchingVerdict[]) {
    const value = VERDICT_VALUE[verdict];
    const intended = INTENDED[verdict];
    const actual: Outcome = {
      tier: tierFor(value, knobs.knownnessThreshold),
      rare: isRare(value, knobs.scoring),
    };
    if (describe(intended) === describe(actual)) continue;
    faults.push({
      verdict,
      value,
      expected: describe(intended),
      actual: describe(actual),
      knob: intended.tier === actual.tier ? "rareKnownnessCutoff" : "knownnessThreshold",
    });
  }
  return faults;
}

/** What a sentinel produces: which Tier, and — for an Answer — whether it is rare. */
interface Outcome {
  tier: Tier;
  rare: boolean;
}

/**
 * What each verdict was chosen to produce. A Bonus Word's rarity is not part of
 * its meaning — Bonus Words score nothing, so no rare bonus is at stake — which
 * is why `describe` reads rarity only for an Answer.
 */
const INTENDED: Record<PatchingVerdict, Outcome> = {
  bonus: { tier: "bonus", rare: false },
  "answer-rare": { tier: "answer", rare: true },
  "answer-common": { tier: "answer", rare: false },
};

function describe(outcome: Outcome): string {
  if (outcome.tier === "bonus") return "a Bonus Word";
  return outcome.rare ? "an Answer, and rare" : "an ordinary Answer";
}

/** Quote a field only when it needs it, so the file stays readable in a diff. */
function csvField(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}
