/**
 * The pinned Wiktionary extract (#268): General American transcriptions written
 * by Wiktionary's editors, independent of CMUdict, read through Kaikki's
 * Wiktextract dump. A Batch reads it offline to find the scored Answers worth
 * putting to the Judge (`src/noFalseAccepts.ts`). It is never shipped in the
 * Rhyme Index and never decides a verdict.
 *
 * The extract (`data/wiktionary.tsv`) is one `word<TAB>transcription` line per
 * transcription tagged `General-American` or `US`, kept as Wiktionary wrote it,
 * stress marks included. It is built from the dump by
 * `scripts/extract-wiktionary.ts` and mirrored like the index sources (#272).
 * Licence CC BY-SA 4.0 and GFDL (`THIRD-PARTY-NOTICES.md`).
 *
 * ## Reading a transcription as ARPAbet
 *
 * A Rhyme Key is computed from ARPAbet, so a transcription is read into it and
 * then put through the build's Normalisation, the way a dictionary reading is.
 * The reading follows CMUdict's habits where they differ from IPA's, so a
 * difference of notation is not taken for a difference of sound: a vowel before
 * r-colouring is the vowel and `R` (`sphere` /sfɪɚ/ is `S F IH1 R`), the er vowel
 * absorbs an `r` after it (`hurry` /ˈhɝɹi/ is `HH ER1 IY0`), a weak schwa before
 * `ɹ` is `ER0`, a tap or a glottal stop is `T`, and the raised vowel before `ŋ`
 * is `AE`. The comparator is approximate, and a word it misreads is only sent to
 * the Judge, who rules on it with nothing of this reading shown.
 *
 * What cannot be read is dropped rather than half read: a transcription with a
 * symbol outside the table, or a fragment of a word (`/-ni.əl/`). A transcription
 * written without a stress mark has its first vowel stressed, which is right for
 * the monosyllables Wiktionary leaves unmarked and for most of the rest (`hour`
 * /aʊɚ/, `hacker` /hækəɹ/). Alternatives (`[ˈbæŋkɚ] ~ [ˈbæŋkɹ̩]`) and sounds in
 * brackets are each read as a reading of their own.
 */

import { applyNormalisation } from "./normalise.ts";
import type { Pronunciation } from "./phonology.ts";

// ---- the extract -------------------------------------------------------------

/** The accents a transcription is kept for: merged General American's own tags. */
const AMERICAN_TAGS = new Set(["General-American", "US"]);

/** A headword the extract keeps: one lower-case word, as the word list spells words. */
const HEADWORD = /^[a-z']+$/;

/**
 * The extract lines one Kaikki entry contributes: its General American and US
 * transcriptions, in the order the entry lists them. A capitalised headword is
 * left out, since `Polish` is not said as `polish`; a name is found by the names
 * data instead.
 */
export function extractLines(entry: unknown): [string, string][] {
  const e = entry as { word?: unknown; lang_code?: unknown; sounds?: unknown } | null;
  if (!e || typeof e.word !== "string" || e.lang_code !== "en" || !HEADWORD.test(e.word) || !Array.isArray(e.sounds)) return [];
  const out: [string, string][] = [];
  for (const s of e.sounds as { ipa?: unknown; tags?: unknown }[]) {
    if (typeof s?.ipa !== "string" || !Array.isArray(s.tags) || !s.tags.some((t) => AMERICAN_TAGS.has(t as string))) continue;
    if (!out.some(([, ipa]) => ipa === s.ipa)) out.push([e.word, s.ipa]);
  }
  return out;
}

/** The extract as the pinned file: a commented header, then the lines sorted and without repeats. */
export function serialiseWiktionaryExtract(lines: Iterable<readonly [string, string]>, ...header: string[]): string {
  const unique = [...new Set([...lines].map(([w, ipa]) => `${w}\t${ipa}`))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return [...header.map((h) => `# ${h}`), ...unique].map((l) => `${l}\n`).join("");
}

/** Word -> its transcriptions, in file order. */
export type WiktionaryExtract = ReadonlyMap<string, readonly string[]>;

export function parseWiktionaryExtract(text: string): WiktionaryExtract {
  const out = new Map<string, string[]>();
  for (const line of text.split(/\r?\n/)) {
    if (line === "" || line.startsWith("#")) continue;
    const tab = line.indexOf("\t");
    if (tab < 1) continue;
    const word = line.slice(0, tab);
    (out.get(word) ?? out.set(word, []).get(word)!).push(line.slice(tab + 1));
  }
  return out;
}

/** A word's transcriptions read as ARPAbet and normalised as the build normalises CMUdict's. Empty when it has none. */
export function wiktionaryReadings(extract: WiktionaryExtract, word: string): Pronunciation[] {
  const seen = new Set<string>();
  const readings: Pronunciation[] = [];
  for (const ipa of extract.get(word) ?? []) {
    for (const r of ipaReadings(ipa)) {
      if (!seen.has(r.join(" "))) readings.push(r);
      seen.add(r.join(" "));
    }
  }
  if (readings.length === 0) return [];
  const pronunciations = new Map([[word, readings]]);
  applyNormalisation({ pronunciations });
  return pronunciations.get(word)!;
}

// ---- IPA to ARPAbet --------------------------------------------------------------

/** Vowels, with any `R` an r-coloured one carries. The longest spelling is tried first. */
const VOWELS: Record<string, [string, ...string[]]> = {
  "aɪ": ["AY"], "aʊ": ["AW"], "ɔɪ": ["OY"], "oʊ": ["OW"], "əʊ": ["OW"], "ɔʊ": ["OW"], "eɪ": ["EY"], "ɛɪ": ["EY"],
  // The raised vowel of `fight` and `out`, written as Canada and parts of the US say it.
  "əɪ": ["AY"], "ʌɪ": ["AY"], "ʊu": ["UW"],
  // The raised /æ/ of `staff` and `channel`; before r, the vowel of `care` (below).
  "eə": ["AE"], "ɛə": ["AE"],
  "iɚ": ["IY", "R"], "ɪɚ": ["IH", "R"], "ɛɚ": ["EH", "R"], "eɚ": ["EH", "R"], "æɚ": ["AE", "R"],
  "ʊɚ": ["UH", "R"], "uɚ": ["UW", "R"], "ɔɚ": ["AO", "R"], "oɚ": ["AO", "R"], "ɑɚ": ["AA", "R"], "aɚ": ["AA", "R"],
  "ɝ": ["ER"], "ɚ": ["ER"], "ɜ": ["ER"],
  i: ["IY"], "ɪ": ["IH"], "ᵻ": ["IH"], "ɨ": ["IH"], e: ["EY"], "ɛ": ["EH"], "æ": ["AE"],
  a: ["AA"], "ä": ["AA"], "ɑ": ["AA"], "ɒ": ["AA"], "ɔ": ["AO"], o: ["OW"], "ʊ": ["UH"], u: ["UW"], "ʉ": ["UW"],
  "ʌ": ["AH"], "ə": ["AH"], "ɐ": ["AH"], "ɘ": ["AH"], "ɵ": ["OW"],
};

/** Syllabic consonants: a weak vowel and the consonant. */
const SYLLABIC: Record<string, string[]> = {
  "l̩": ["AH", "L"], "ɫ̩": ["AH", "L"], "n̩": ["AH", "N"], "m̩": ["AH", "M"], "ɹ̩": ["ER"],
};

const CONSONANTS: Record<string, string> = {
  "tʃ": "CH", "dʒ": "JH", p: "P", b: "B", t: "T", d: "D", k: "K", "ɡ": "G", g: "G", f: "F", v: "V",
  "θ": "TH", "ð": "DH", s: "S", z: "Z", "ʃ": "SH", "ʒ": "ZH", h: "HH", m: "M", n: "N", "ŋ": "NG",
  l: "L", "ɫ": "L", "ɹ": "R", r: "R", "ɻ": "R", w: "W", "ʍ": "W", j: "Y", "ɾ": "T", "ʔ": "T", x: "K",
};

const SPELLINGS = [...Object.keys(VOWELS), ...Object.keys(SYLLABIC), ...Object.keys(CONSONANTS)].sort((a, b) => b.length - a.length);

/** Marks that say nothing a Rhyme Key holds: length, tie bars, aspiration, devoicing and the like. */
const IGNORED = /[ːˑ̯̥̬͜͡ʰ̪̚ʷʲ̞̝̠̟̈̆ˀ̊‿̃]/gu;

type Token = { stress: 1 | 2 } | { boundary: true } | { vowel: string[]; syllabic?: true } | { consonant: string };

/** The readings an IPA transcription spells, one per way of taking its bracketed sounds. Empty when it cannot be read. */
export function ipaReadings(ipa: string): Pronunciation[] {
  const out: Pronunciation[] = [];
  // `[ˈbæŋkɚ] ~ [ˈbæŋkɹ̩]` gives two ways of saying the word.
  for (const alternative of ipa.split("~")) {
    const body = alternative.trim().replace(/^[/[]|[/\]]$/g, "").trim();
    // A fragment (`/-ni.əl/`) is part of a word, which has no Rhyme Key of its own.
    if (body === "" || body.startsWith("-") || body.endsWith("-")) continue;
    for (const variant of optionalVariants(body.replace(/\s+/g, "."))) {
      const r = readVariant(variant);
      if (r && !out.some((o) => o.join(" ") === r.join(" "))) out.push(r);
    }
  }
  return out;
}

/** Each way of taking or leaving the sounds in brackets, taking first. More than three brackets reads nothing. */
function optionalVariants(body: string): string[] {
  const m = /\(([^()]*)\)/.exec(body);
  if (!m) return [body];
  if ((body.match(/\(/g) ?? []).length > 3) return [];
  const before = body.slice(0, m.index);
  const after = body.slice(m.index + m[0].length);
  return [...optionalVariants(before + m[1] + after), ...optionalVariants(before + after)];
}

function tokenise(body: string): Token[] | null {
  const s = body
    .replace(/ʧ/g, "tʃ").replace(/ʤ/g, "dʒ")
    .replace(/ɾ̃/g, "nt")
    // The nasalised /æ/ of `sang` (/ˈsɛ̃ŋ/); the raised one before r is the vowel of `care`.
    .replace(/ɛ̃/g, "æ")
    .replace(/[eɛ]ə(?=ɹ)/g, "ɛ")
    .replace(/ɜ˞/g, "ɝ").replace(/ə˞/g, "ɚ").replace(/˞/g, "ɹ")
    .replace(/̍/g, "̩")
    .replace(IGNORED, "");
  const tokens: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === "ˈ" || c === "'") { tokens.push({ stress: 1 }); i++; continue; }
    if (c === "ˌ") { tokens.push({ stress: 2 }); i++; continue; }
    if (c === "." || c === "-") { tokens.push({ boundary: true }); i++; continue; }
    const spelling = SPELLINGS.find((sp) => s.startsWith(sp, i));
    if (!spelling) return null;
    if (VOWELS[spelling]) tokens.push({ vowel: [...VOWELS[spelling]!] });
    else if (SYLLABIC[spelling]) tokens.push({ vowel: [...SYLLABIC[spelling]!], syllabic: true });
    else tokens.push({ consonant: CONSONANTS[spelling]! });
    i += spelling.length;
  }
  return tokens;
}

function readVariant(body: string): Pronunciation | null {
  const tokens = tokenise(body);
  if (!tokens) return null;
  if (!tokens.some((t) => "vowel" in t)) return null;
  // Unmarked, the first vowel carries the stress: Wiktionary leaves monosyllables
  // unmarked, and the longer words it leaves so are mostly `hour` and `hacker`.
  const marked = tokens.some((t) => "stress" in t);

  const out: Pronunciation = [];
  let pending: 0 | 1 | 2 = marked ? 0 : 1;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const next = tokens[i + 1];
    if ("stress" in t) { pending = t.stress; continue; }
    if ("boundary" in t) continue;
    if ("consonant" in t) {
      // The er vowel absorbs an r after it, as CMUdict writes `hurry`.
      if (t.consonant === "R" && out.length && out[out.length - 1]!.startsWith("ER")) continue;
      out.push(t.consonant);
      continue;
    }
    const [sound, ...rest] = t.vowel;
    let vowel = sound!;
    const nextR = next !== undefined && "consonant" in next && next.consonant === "R";
    if (vowel === "OW" && nextR) vowel = "AO";
    if (vowel === "EY" && next !== undefined && "consonant" in next && next.consonant === "NG") vowel = "AE";
    // A weak schwa before r is CMUdict's ER0; a stress mark between them makes the r an onset instead.
    if (vowel === "AH" && pending === 0 && !t.syllabic && nextR) { vowel = "ER"; i++; }
    if (t.syllabic && vowel === "AH") {
      out.push(`AH${pending}`, ...rest);
    } else {
      out.push(`${vowel}${pending}`, ...rest);
    }
    pending = 0;
  }
  return out;
}
