/**
 * Builds a RhymeIndex over the mini fixtures. This fixture IS the pinned data
 * for the test suite, so it is the source of truth for the verdicts below — the
 * tests assert verdicts, never the mechanism that produces them.
 *
 * It builds them the way the shipped build does: one call to
 * `manufactureIndexData`, which runs all four stages in the committed order
 * (#106). The alternative was a helper that ran only the tail, which left two
 * compositions of the stage order in the repo — and the one the tests exercised
 * was not the one that ships.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCmudict } from "../cmudict.ts";
import type { Pronunciation } from "../phonology.ts";
import type { RhymeIndex, RhymeIndexData } from "../rhymeIndex.ts";
import { buildSlice, type FixtureSlice } from "./build.ts";

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
  // The syllabic-consonant variant and the two vowels it must not touch: a
  // stressed one (`pool`) and a full unstressed one (`crayon`) — issue #74.
  "cool", "pool", "gruel", "duel", "crewel", "renewal", "crane", "crayon",
  // `sate` is a real word we deliberately leave out of the prevalence data,
  // to exercise the absent-from-knownness -> Bonus default (ADR-0003).
  "sate",
  // `grates` is a real word we deliberately leave out of CMUdict: it passes
  // the wordhood gate but has no pronunciation, exercising the truthful
  // no-pronunciation verdict (a player hears it rhyming with `plates`, but the
  // engine has nothing to rhyme-test) — issue #28.
  "grates",
  // Stress promotion (issue #73): `module` gains a promoted reading; the rest
  // are what the rule must not reach — a word-final vowel and a lone
  // inflectional coda.
  "module", "happy", "smelly", "high", "buy", "eye", "arrows", "nose",
  // Coverage derivation (issue #76): both are real words with wordhood and a
  // prevalence score but no CMUdict reading, so the build composes one from a
  // stem it already reads — `docked` and `walked`. They sit in the `AA K T`
  // family on purpose, which no other suite counts.
  "undocked", "outwalked",
  // Suffix derivation (issue #77). Each stem carries a reading; each suffixed
  // form has none, so the build composes it. They are paired so that every
  // composed reading has something to be adjudicated against: `-er` on
  // `abolish`/`polish`, `-ness` on `youthful`/`truthful`, `-ly` on
  // `zestful`/`restful` (the degemination case) and `abashed`/`unabashed`, and
  // `-er` on `yodel` through both its spellings — `yodeller` is the undoubling
  // stem candidate. Each pair is its own Rhyme Key family, which no other suite
  // counts.
  "abolish", "abolisher", "polish", "polisher",
  "youthful", "youthfulness", "truthful", "truthfulness",
  "zestful", "zestfully", "restful", "restfully",
  "abash", "abashed", "abashedly", "unabashed", "unabashedly",
  // `cussedly` is the regression: it must be derived from `cuss`, not from the
  // participle, or it rhymes with `justly`.
  "cuss", "cussed", "cussedly", "justly",
  "yodel", "yodeler", "yodeller",
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
  // The two derived words (issue #76), scored either side of the threshold so
  // the tier split falls out of the ordinary rule and not a special case.
  ["undocked", 2.0], ["outwalked", 0.4],
  // `unwalked` is scored but deliberately withheld from the wordhood set above:
  // derivation supplies readings and never wordhood, so it stays underived and
  // still rejects as not a known word.
  ["unwalked", 2.0],
  ["cool", 2.5], ["pool", 2.5], ["gruel", 1.6], ["duel", 2.0],
  // `crewel` is a kind of yarn almost nobody knows — a Bonus Word, so the
  // syllabic variant is exercised on both sides of the knownness threshold.
  ["crewel", 0.4], ["renewal", 2.3], ["crane", 2.4], ["crayon", 2.4],
  // Suffix derivation (issue #77). Every derived word needs a knownness of its
  // own: `-er` and `-ly` forms are not lemmas the prevalence data would carry,
  // so the derivation target set requires them here. `yodeler` and `yodeller`
  // sit below the threshold, so the pair tiers as Bonus Words on the ordinary
  // rule — the same split #76 exercised, on this slice's suffixes.
  ["abolish", 2.0], ["abolisher", 1.4], ["polish", 2.3], ["polisher", 1.5],
  ["youthful", 2.2], ["youthfulness", 1.8], ["truthful", 2.3], ["truthfulness", 1.9],
  ["zestful", 1.5], ["zestfully", 1.3], ["restful", 2.0], ["restfully", 1.7],
  ["abash", 1.3], ["abashed", 1.4], ["abashedly", 1.1],
  ["unabashed", 1.6], ["unabashedly", 1.5],
  ["cuss", 1.9], ["cussed", 1.5], ["cussedly", 1.1], ["justly", 2.0],
  ["yodel", 1.6], ["yodeler", 0.6], ["yodeller", 0.5],
  // Stress promotion (issue #73), all common enough to tier as Answers.
  ["module", 2.3], ["happy", 2.5], ["smelly", 2.2],
  ["high", 2.5], ["buy", 2.5], ["eye", 2.5], ["arrows", 2.4], ["nose", 2.5],
]);

export const KNOWNNESS_THRESHOLD = 1.0;

/**
 * What a test adds to the fixture's pinned inputs before the build runs.
 *
 * The fixture keeps its data as maps and sets because that is how it is legible,
 * and everything here is folded into those and then serialised back to the
 * upstream text formats — because the build parses its own inputs (#100), and a
 * caller that handed over parsed structures would be back to holding the stages
 * in the right order itself. A reading given here *replaces* the fixture's, the
 * way `set` did when tests assembled the data by hand.
 */
export interface TestInputs {
  /** Readings to add or correct, replacing the fixture's for that word. */
  pronunciations?: [string, Pronunciation[]][];
  /** Words to grant wordhood to, beyond the set above. */
  words?: string[];
  /** Names to add, beyond `kate`. */
  names?: string[];
  /** Knownness scores to add or override. */
  prevalence?: [string, number][];
  /** The demotion list (#90) this build runs. Absent means the stage runs empty. */
  demotions?: string;
  /** The supplement (ADR-0009) this build runs. Likewise. */
  supplement?: string;
  /** The Retrieval override layer (ADR-0015) this build runs. Likewise. */
  tierOverrides?: string;
  /** The tier cutoff, for a test that needs to move it. */
  knownnessThreshold?: number;
}

/** This fixture's slice, with a test's additions folded in. */
function testSlice(inputs: TestInputs): FixtureSlice {
  const readings = parseCmudict(cmudictText);
  for (const [word, prons] of inputs.pronunciations ?? []) readings.set(word, prons);

  return {
    pronunciations: readings,
    words: [...words, ...(inputs.words ?? [])],
    names: [...names, ...(inputs.names ?? [])],
    prevalence: new Map([...prevalence, ...(inputs.prevalence ?? [])]),
    demotions: inputs.demotions,
    supplement: inputs.supplement,
    tierOverrides: inputs.tierOverrides,
  };
}

/**
 * A test index, built by the same call `npm run build:index` makes: all four
 * stages — demotions, supplement, coverage, normalisation — in the committed
 * order, over this fixture's inputs (#106). Tests go through here rather than
 * calling `new RhymeIndex` so the verdicts they assert are the verdicts a real
 * build would produce, including the guardrail table, which every stage has to
 * survive. The finished `data` comes back too, because it is what the build
 * would have serialised.
 */
export function buildTestIndex(inputs: TestInputs = {}): {
  index: RhymeIndex;
  data: RhymeIndexData;
} {
  return buildSlice(testSlice(inputs), inputs.knownnessThreshold ?? KNOWNNESS_THRESHOLD);
}

/** `buildTestIndex` for the callers that want only the index. */
export function makeTestIndex(inputs: TestInputs = {}): RhymeIndex {
  return buildTestIndex(inputs).index;
}

/**
 * The raw inputs *parsed but unbuilt*, as a stage sees them before it runs —
 * for a test that exercises one stage directly and asserts on what that stage
 * did to the data. A test that wants the verdicts of a finished index wants
 * `buildTestIndex` instead. Copies throughout, so a stage's mutations stay in
 * the test that made them.
 */
export function makeTestData(): RhymeIndexData {
  return {
    pronunciations: parseCmudict(cmudictText),
    words: new Set(words),
    names: new Set(names),
    prevalence: new Map(prevalence),
  };
}
