/**
 * The tested half of `scripts/lookup.ts`: its flags, what one lookup in the
 * Rhyme Index holds, and how it reads on a terminal. Loading the index stays in
 * the shell, so all of this is tested without the 15 MB built artifact.
 */

import { normaliseWord } from "../src/cmudict.ts";
import { rhymeKeyOf, type Pronunciation, type RhymeKey } from "../src/phonology.ts";
import { respell } from "../src/respelling.ts";
import type { RhymeIndex } from "../src/rhymeIndex.ts";
import type { Tier } from "../src/verdict.ts";
import type { DemotionReason } from "../src/demotions.ts";

export const LOOKUP_HELP = `Look up words or a Rhyme Key in the built Rhyme Index (dist-data/).

  npx tsx scripts/lookup.ts <word> [<word> ...]
      For each word: every pronunciation and the source it came from, each
      Rhyme Key, the Tier and knownness, and whether the word is in the word
      list, the names data or the Demotions.

  npx tsx scripts/lookup.ts --key "<rhyme key>"
      The family of one Rhyme Key, each member under its Tier. The key is
      ARPAbet as a word lookup prints it ("IH R"); stress digits and case are
      ignored, and the quotes may be dropped.

Invoke through tsx, not npm run: PowerShell eats the bare -- separator.`;

export type LookupArgs =
  | { kind: "help" }
  | { kind: "words"; words: string[] }
  | { kind: "key"; rhymeKey: RhymeKey };

/** Throws on input it cannot read; `lookup.ts` turns the throw into a clean exit. */
export function parseLookupArgs(argv: string[]): LookupArgs {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) return { kind: "help" };
  const [first, ...rest] = argv;
  if (first === "--key" || first!.startsWith("--key=")) {
    const parts = first === "--key" ? rest : [first!.slice("--key=".length), ...rest];
    const rhymeKey = parts
      .join(" ")
      .toUpperCase()
      .replace(/[0-9]/g, "")
      .split(/\s+/)
      .filter((sound) => sound !== "")
      .join(" ");
    if (rhymeKey === "") throw new Error('--key needs a Rhyme Key, e.g. --key "IH R"');
    return { kind: "key", rhymeKey };
  }
  const unknown = argv.find((token) => token.startsWith("-"));
  if (unknown !== undefined) throw new Error(`Unknown argument: ${unknown}`);
  return { kind: "words", words: argv.map(normaliseWord) };
}

/** Where one reading of a word came from in the build (`src/manufacture.ts`). */
export type ReadingSource =
  | { kind: "cmudict" }
  | { kind: "supplement" }
  | { kind: "derived"; stem: string; rule: string }
  | { kind: "normalisation" };

export interface Reading {
  pronunciation: Pronunciation;
  respelling: string;
  /** Null for a reading with no stressed vowel, which anchors no rhyme. */
  rhymeKey: RhymeKey | null;
  source: ReadingSource;
}

export interface WordLookup {
  word: string;
  readings: Reading[];
  /** In the wordhood gate as built, so after any Demotion. */
  inWordList: boolean;
  /** In the names data as built, so including a demoted name. */
  isName: boolean;
  demotion: DemotionReason | null;
  tier: Tier;
  knownness: number | null;
}

/** General American IPA for each ARPAbet sound, so a key reads as the glossary writes it. */
const IPA: Record<string, string> = {
  AA: "ɑ", AE: "æ", AH: "ə", AO: "ɔ", AW: "aʊ", AY: "aɪ", EH: "ɛ", ER: "ɝ",
  EY: "eɪ", IH: "ɪ", IY: "i", OW: "oʊ", OY: "ɔɪ", UH: "ʊ", UW: "u",
  B: "b", CH: "tʃ", D: "d", DH: "ð", F: "f", G: "ɡ", HH: "h", JH: "dʒ", K: "k",
  L: "l", M: "m", N: "n", NG: "ŋ", P: "p", R: "r", S: "s", SH: "ʃ", T: "t",
  TH: "θ", V: "v", W: "w", Y: "j", Z: "z", ZH: "ʒ",
};

/** A Rhyme Key as the index spells it, followed by its IPA: `IH R /ɪr/`. */
export function showKey(key: RhymeKey): string {
  const ipa = key
    .split(" ")
    .map((sound) => IPA[sound] ?? sound.toLowerCase())
    .join("");
  return `${key} /${ipa}/`;
}

function showSource(source: ReadingSource): string {
  switch (source.kind) {
    case "cmudict":
      return "CMUdict";
    case "supplement":
      return "data/supplement.dict";
    case "derived":
      return `derived from ${source.stem} (${source.rule})`;
    case "normalisation":
      return "appended by Normalisation";
  }
}

const TIER_NAME: Record<Tier, string> = { answer: "Answer", bonus: "Bonus Word" };

const yesNo = (value: boolean) => (value ? "yes" : "no");

export function formatWordLookup(lookup: WordLookup): string {
  const demoted = lookup.demotion === null ? "no" : `yes (${lookup.demotion})`;
  const lines = [
    lookup.word,
    `  word list: ${yesNo(lookup.inWordList)}  names: ${yesNo(lookup.isName)}  demoted: ${demoted}`,
  ];
  // A Tier belongs to a word with wordhood; anything else is rejected before
  // its Tier is ever read, so printing one would claim a verdict nobody gets.
  if (lookup.inWordList) {
    const knownness = lookup.knownness === null ? "no knownness" : `knownness ${lookup.knownness}`;
    lines.push(`  Tier: ${TIER_NAME[lookup.tier]} (${knownness})`);
  }
  if (lookup.readings.length === 0) {
    lines.push("  no pronunciation in the index, so no Rhyme Key");
  }
  for (const reading of lookup.readings) {
    const key = reading.rhymeKey === null ? "no Rhyme Key" : showKey(reading.rhymeKey);
    lines.push(
      `  ${reading.pronunciation.join(" ")}  (${reading.respelling})  ${key}  [${showSource(reading.source)}]`,
    );
  }
  return lines.join("\n");
}

export interface FamilyLookup {
  rhymeKey: RhymeKey;
  members: { word: string; tier: Tier }[];
  /** A Schwa Twin whose words this key also matches (`RhymeFamily.mergedKeys`). */
  mergedKeys: RhymeKey[];
}

/**
 * What the build knew about where readings and wordhood came from, which the
 * serialised index does not keep: the committed supplement and Demotions, and
 * the derived-words report the build writes beside the index.
 */
export interface BuildProvenance {
  supplemented: ReadonlySet<string>;
  derived: ReadonlyMap<string, { stem: string; rule: string }>;
  demotions: ReadonlyMap<string, DemotionReason>;
}

/**
 * A supplemented word has every upstream reading replaced, and a derived word
 * had none to begin with, so a word's base readings share one source. Only a
 * reading Normalisation appended differs, and the index recognises those.
 */
function baseSource(word: string, provenance: BuildProvenance): ReadingSource {
  if (provenance.supplemented.has(word)) return { kind: "supplement" };
  const derived = provenance.derived.get(word);
  if (derived !== undefined) return { kind: "derived", ...derived };
  return { kind: "cmudict" };
}

export function lookUpWord(index: RhymeIndex, word: string, provenance: BuildProvenance): WordLookup {
  const normalised = normaliseWord(word);
  const base = baseSource(normalised, provenance);
  return {
    word: normalised,
    readings: index.readingsOf(normalised).map(({ pronunciation, generated }) => ({
      pronunciation,
      respelling: respell(pronunciation),
      rhymeKey: rhymeKeyOf(pronunciation),
      source: generated ? { kind: "normalisation" } : base,
    })),
    inWordList: index.hasWord(normalised),
    isName: index.isName(normalised),
    demotion: provenance.demotions.get(normalised) ?? null,
    ...index.tierOf(normalised),
  };
}

export function lookUpFamily(index: RhymeIndex, rhymeKey: RhymeKey): FamilyLookup {
  const family = index.familyOf(rhymeKey);
  return {
    rhymeKey,
    members: family.members.map(({ word, tier }) => ({ word, tier })),
    mergedKeys: family.mergedKeys,
  };
}

export function formatFamilyLookup(family: FamilyLookup): string {
  const lines = [showKey(family.rhymeKey)];
  if (family.mergedKeys.length > 0) {
    lines.push(`  also matches ${family.mergedKeys.join(", ")} (Schwa Twin)`);
  }
  if (family.members.length === 0) {
    lines.push("  no word in the index has this Rhyme Key");
    return lines.join("\n");
  }
  for (const [tier, heading] of [["answer", "Answers"], ["bonus", "Bonus Words"]] as const) {
    const words = family.members.filter((m) => m.tier === tier).map((m) => m.word);
    lines.push(`  ${heading} (${words.length}): ${words.join(", ")}`);
  }
  return lines.join("\n");
}
