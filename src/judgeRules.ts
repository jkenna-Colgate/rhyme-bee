/**
 * The rules of #232 applied by machine: a labelling tool for measuring the
 * Judge, never part of the loop (#238 took the rules out of it). A pair the
 * rules decide is labelled by them at scoring time, from the index as it reads
 * now, so a label never goes stale when a Normalisation lands; only the pairs
 * they leave open are put to a person, and only a person's verdicts are stored
 * (#250, `data/judge-labels/`).
 *
 * Ported from `scripts/judge.prototype/rules.ts` on `prototype/238-judge-margin`.
 * Three things changed in the port. The two Normalisations #232 decided, and the
 * hand-written readings, were applied there because they were not built; they are
 * built now, so a reading here is read through the build's own Normalisation
 * instead. A reading the rules derive (a regular form, a compound) is put through
 * it too. And the second dictionary, Wiktionary, comes with each pair in the
 * label set rather than from a file in `.scratch/`.
 *
 * The question is Points only: is this pair a Rhyme, given the right reading. A
 * Weak Rhyme is never asked about; here it is simply "no Points".
 */

import { disputedShape, readingsReachKey } from "./judge.ts";
import { applyNormalisation } from "./normalise.ts";
import { bareSound, isVowel, isVowelSound, stressOf, type Pronunciation, type RhymeKey } from "./phonology.ts";

/** What the rules read off the index. */
export interface RulesLexicon {
  /** The readings a Rhyme is decided on, Normalisation applied. */
  readingsOf(word: string): readonly Pronunciation[];
  /** The same readings with each weak vowel as the dictionary wrote it. */
  unmergedReadingsOf(word: string): readonly Pronunciation[];
  isWord(word: string): boolean;
  /** In the Answer band. The word list also holds `lish`, `kish` and `rick`, which split `abolish`, `bookish` and `derrick`. */
  known(word: string): boolean;
}

/** One pair, with Wiktionary's US transcriptions of its word (IPA, space-separated segments). */
export interface RulesPair {
  word: string;
  rhymeKey: RhymeKey;
  wiktionary: readonly string[];
}

export type RuleVerdict = "rhyme" | "no-rhyme" | "ask" | "out";
export interface RuleDecision {
  verdict: RuleVerdict;
  why: string;
}

// ---- reading a derived reading the way the build reads one --------------------

/** A derived reading as the index would hold it, and as the dictionary would have written it. */
function asBuilt(readings: readonly Pronunciation[]): Pronunciation[] {
  const pronunciations = new Map([["", readings.map((r) => [...r])]]);
  applyNormalisation({ pronunciations });
  return pronunciations.get("")!;
}

// ---- the shapes the rules name ---------------------------------------------

const sounds = (p: Pronunciation) => p.map(bareSound);
const vowelsAt = (p: Pronunciation) => p.flatMap((x, i) => (isVowel(x) ? [i] : []));

/** The last syllable's rime is the key, and the stress falls earlier: at most a Weak Rhyme, so no Points. */
function matchesUnstressed(reading: Pronunciation, key: RhymeKey): boolean {
  if (key.split(" ").filter(isVowelSound).length !== 1) return false;
  const v = vowelsAt(reading);
  if (!v.length || readingsReachKey([reading], key)) return false;
  return sounds(reading.slice(v[v.length - 1]!)).join(" ") === key;
}

// ---- the second dictionary -------------------------------------------------

const IPA: Record<string, string> = {
  ɪ: "IH", ə: "AH", i: "IY", ɛ: "EH", æ: "AE", ʊ: "UH", ɑ: "AA", ɒ: "AA", ɔ: "AO", ʌ: "AH", u: "UW", ɚ: "ER", ɝ: "ER", ɜ: "ER",
  o: "OW", e: "EY", a: "AA", ɨ: "IH", ᵻ: "IH", ɘ: "IH", ɐ: "AH", ʉ: "UW",
  n: "N", t: "T", ɹ: "R", s: "S", l: "L", k: "K", m: "M", d: "D", p: "P", b: "B", f: "F", z: "Z", ɡ: "G", v: "V", ʃ: "SH",
  ŋ: "NG", j: "Y", w: "W", h: "HH", "d͡ʒ": "JH", "t͡ʃ": "CH", θ: "TH", ð: "DH", ʒ: "ZH", ɾ: "T", ʍ: "W", ɫ: "L", ʔ: "T", x: "K",
};
const JOIN: Record<string, string> = { "AA IH": "AY", "AA UH": "AW", "EY IH": "EY", "OW UH": "OW", "AO IH": "OY", "AH UH": "OW" };
const GLIDE = new Set(["AY", "AW", "OY"]);

/** One Wiktionary reading as bare sounds, or null when it holds a segment this crude table does not know. */
function ipaToSounds(ipa: string): string[] | null {
  const out: string[] = [];
  let glided = false;
  // One entry in nine writes an affricate as two segments with no tie bar (`mycologist` as d, ʒ).
  for (const raw of ipa.trim().replace(/d ʒ/g, "d͡ʒ").replace(/t ʃ/g, "t͡ʃ").split(" ")) {
    const syllabic = raw.includes("̩");
    const seg = raw.replace(/[ː̯̩ʰ̃˞]/g, "");
    if (!seg) continue;
    const s = IPA[seg];
    if (!s) return null;
    if (syllabic) out.push(...(s === "R" ? ["ER"] : ["AH", s]));
    else {
      // A glide joins once: `flaying` is e, ɪ, ɪ, and the second ɪ is a syllable of its own.
      const joined: string | undefined = glided ? undefined : JOIN[`${out[out.length - 1]} ${s}`];
      if (joined) out[out.length - 1] = joined; else out.push(s);
      glided = !!joined;
      continue;
    }
    glided = false;
  }
  return out;
}

/** Both dictionaries written one way: merged General American, and the spellings of a vowel before `r`. */
function norm(s: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    let x = s[i]!;
    const next = s[i + 1], after = s[i + 2];
    if (next === "R") {
      if (x === "OW") x = "AO";
      if (x === "EY") x = "EH";
      if (x === "IY") x = "IH";
      if (x === "UW") x = "UH";
      if ((x === "AH" || x === "ER") && !(after && isVowelSound(after))) { out.push("ER"); i++; continue; }
    } else if (x === "AO") x = "AA";
    if (x === "ER" && GLIDE.has(out[out.length - 1] ?? "")) x = "R";
    out.push(x);
  }
  return out;
}

function wiktReadings(pair: RulesPair): string[][] {
  return pair.wiktionary.map(ipaToSounds).filter((s): s is string[] => s !== null).map(norm);
}

/**
 * Does any Wiktionary reading end in the key's sounds? Stress is not in the
 * file, so this can refute a Rhyme and never prove one. Inside the key, weak
 * "ih" and weak "uh" are one sound, and a key's tap `D` after a vowel or `r` is
 * met by Wiktionary's t, as the build reads them.
 */
function wiktEndsIn(pair: RulesPair, key: RhymeKey): boolean | null {
  const readings = wiktReadings(pair);
  if (!readings.length) return null;
  const k = norm(key.split(" "));
  const same = (r: string[], at: number, x: string, i: number) => {
    const a = r[at]!;
    if (a === x) return true;
    if (i === 0) return false;
    if (["IH", "AH"].includes(a) && ["IH", "AH"].includes(x)) return true;
    const before = r[at - 1];
    return x === "D" && a === "T" && !!before && (isVowelSound(before) || before === "R");
  };
  return readings.some((r) => r.length >= k.length && k.every((x, i) => same(r, r.length - k.length + i, x, i)));
}

/** Wiktionary reads the word as one syllable ending in a one-syllable key: the only reading in the file whose stress is not in doubt. */
function wiktProves(pair: RulesPair, key: RhymeKey): boolean {
  const k = norm(key.split(" "));
  if (k.filter(isVowelSound).length !== 1 || !wiktEndsIn(pair, key)) return false;
  return wiktReadings(pair).some((r) => r.filter(isVowelSound).length === 1 && r.slice(-k.length).join(" ") === k.join(" "));
}

// ---- readings the rules derive ---------------------------------------------

/**
 * Stress marks no ticket has settled, by name: the seven words the said-back
 * test left open (#235) and the seven it has not been run on (#237). Two of
 * them have two syllables, so the shape test does not catch them.
 */
const NOT_RULED = new Set([
  "counterfeit", "gimmick", "anarchist", "maverick", "apocalypse", "derelict", "walnut",
  "acronym", "asterisk", "benefit", "mannequin", "rhetoric", "catapult", "labyrinth",
]);

const SIBILANT = new Set(["S", "Z", "SH", "ZH", "CH", "JH"]);
const VOICELESS = new Set(["P", "T", "K", "F", "TH", "S", "SH", "CH"]);
const doubles = (stem: string) => /[^aeiou][aeiou][^aeiouwxy]$/.test(stem);

/**
 * The readings of a regular -s, -ed or -ing form whose stem is a word with a
 * reading, written with the stem's weak vowels as the dictionary wrote them.
 * English adds these endings without moving the stress, so the form's reading
 * follows from the stem's.
 */
function inflected(word: string, lex: RulesLexicon): { stem: string; readings: Pronunciation[] } | null {
  const tries: [string, "s" | "ed" | "ing"][] = [];
  if (word.endsWith("ies")) tries.push([word.slice(0, -3) + "y", "s"]);
  if (word.endsWith("s") && !word.endsWith("ss")) tries.push([word.slice(0, -1), "s"]);
  if (word.endsWith("es")) tries.push([word.slice(0, -2), "s"]);
  if (word.endsWith("ied")) tries.push([word.slice(0, -3) + "y", "ed"]);
  if (word.endsWith("ed")) {
    tries.push([word.slice(0, -1), "ed"], [word.slice(0, -2), "ed"]);
    if (word.at(-3) === word.at(-4)) tries.push([word.slice(0, -3), "ed"]);
  }
  if (word.endsWith("ing")) {
    const bare = word.slice(0, -3);
    if (!doubles(bare)) tries.push([bare, "ing"]);
    tries.push([bare + "e", "ing"]);
    if (word.at(-4) === word.at(-5)) tries.push([word.slice(0, -4), "ing"]);
  }
  for (const [stem, form] of tries) {
    const prons = lex.unmergedReadingsOf(stem);
    if (stem.length < 2 || !lex.isWord(stem) || !prons.length) continue;
    // `tares` is tare + s, never tar + es: -es follows a hiss or an o.
    if (form === "s" && stem + "es" === word && !stem.endsWith("o") && !prons.some((p) => SIBILANT.has(p[p.length - 1]!))) continue;
    const readings = prons.flatMap((p): Pronunciation[] => {
      const last = bareSound(p[p.length - 1]!);
      if (form === "ing") return [[...p, "IH0", "NG"]];
      const [syllable, plain, devoiced] = form === "s" ? [SIBILANT.has(last), "Z", "S"] : [last === "T" || last === "D", "D", "T"];
      if (syllable) return [[...p, "AH0", plain], [...p, "IH0", plain]];
      return [[...p, VOICELESS.has(last) ? devoiced : plain]];
    });
    return { stem, readings };
  }
  return null;
}

/**
 * A compound whose last part is a word on the key, the last part keeping its
 * stress as a secondary. Both parts must be in the Answer band, the first three
 * letters or more and the last four, which is what keeps `tann + in`,
 * `re + sin` and `lump + ish` out.
 */
function compound(word: string, key: RhymeKey, lex: RulesLexicon): { parts: string; reading: Pronunciation } | null {
  for (let i = 3; i <= word.length - 4; i++) {
    const head = word.slice(0, i), tail = word.slice(i);
    if (!lex.known(head) || !lex.known(tail)) continue;
    const h = lex.unmergedReadingsOf(head)[0];
    const t = lex.unmergedReadingsOf(tail).find((p) => readingsReachKey(asBuilt([p]), key));
    if (h && t) return { parts: `${head} + ${tail}`, reading: [...h, ...t.map((x) => x.replace(/1$/, "2"))] };
  }
  return null;
}

/** With the stress taken off its last syllable, is this the shape #232 did not rule? */
function lunaticRhythm(reading: Pronunciation, key: RhymeKey): boolean {
  const v = vowelsAt(reading);
  if (v.length < 3) return false;
  return disputedShape(reading.map((x, i) => (i === v[v.length - 1] ? x.replace(/\d$/, "0") : x)), key);
}

const UNRULED = "the shape #232 did not rule";

// ---- the decision ----------------------------------------------------------

/**
 * What the rules make of a pair: a Rhyme, no Rhyme, a question for a person
 * (`ask`), or a pair kept out of the question altogether (`out`).
 */
export function decide(pair: RulesPair, lex: RulesLexicon): RuleDecision {
  const { word, rhymeKey: key } = pair;
  if (!lex.isWord(word)) return { verdict: "out", why: "a wordhood question: not on the word list, so it has no right reading to rule on" };
  if (NOT_RULED.has(word)) return { verdict: "out", why: "a stress mark no ticket has settled" };

  const oneSyllable = key.split(" ").filter(isVowelSound).length === 1;
  const w = wiktEndsIn(pair, key);
  const wiktSays = w === null ? "Wiktionary has no entry" : w ? "Wiktionary ends in the key's sounds" : "Wiktionary does not end in the key's sounds";
  const engine = lex.readingsOf(word);
  const written = lex.unmergedReadingsOf(word);

  if (engine.length) {
    if (readingsReachKey(engine, key)) return { verdict: "rhyme", why: "reaches the key by the engine's reading" };
    if (written.some((r) => matchesUnstressed(r, key)) || engine.some((r) => matchesUnstressed(r, key))) {
      if (written.some((r) => disputedShape(r, key))) return { verdict: "out", why: UNRULED };
      const c = compound(word, key, lex);
      if (c) return { verdict: "ask", why: `the dictionary marks no stress on the last syllable, and the spelling splits as ${c.parts}: a compound missing a mark is a missing reading` };
      return { verdict: "no-rhyme", why: "the last syllable matches and is unstressed: no Points" };
    }
    if (w !== true) return { verdict: "no-rhyme", why: w === false ? "two dictionaries agree it does not reach the key" : "the engine's reading does not reach the key, and Wiktionary has no entry" };
    // The syllabic consonant rule appends a reading with no last vowel (`basin` as B EY1 S N); the fullest reading is the one to ask.
    const most = Math.max(...written.map((r) => vowelsAt(r).length));
    const fullest = written.filter((r) => vowelsAt(r).length === most);
    const lastUnstressed = most > 1 && fullest.every((r) => stressOf(r[vowelsAt(r)[most - 1]!]!) === 0);
    if (oneSyllable && lastUnstressed) {
      const asWikt = fullest.map((r) => [...r.slice(0, vowelsAt(r)[most - 1]!), ...key.split(" ").map((x, i) => (i === 0 ? `${x}0` : x))]);
      if (asWikt.some((r) => disputedShape(r, key))) return { verdict: "out", why: UNRULED };
      return { verdict: "no-rhyme", why: "the dictionaries differ on the last vowel, and the last syllable is unstressed either way: no Points" };
    }
    return { verdict: "ask", why: "the engine's reading does not reach the key, and Wiktionary's ends in its sounds" };
  }

  if (wiktProves(pair, key)) return { verdict: "rhyme", why: "no reading on file; Wiktionary reads it as one syllable ending in the key" };

  const inf = inflected(word, lex);
  if (inf) {
    const form = `the regular form of ${inf.stem}`;
    if (readingsReachKey(asBuilt(inf.readings), key)) {
      return w === false
        ? { verdict: "ask", why: `no reading on file; ${form} reaches the key, and ${wiktSays}` }
        : { verdict: "rhyme", why: `no reading on file; ${form} reaches the key` };
    }
    if (inf.readings.some((r) => disputedShape(r, key))) return { verdict: "out", why: UNRULED };
    if (inf.readings.some((r) => matchesUnstressed(r, key))) return { verdict: "no-rhyme", why: `no reading on file; ${form} matches on an unstressed last syllable: no Points` };
    return w === true
      ? { verdict: "ask", why: `no reading on file; ${form} does not reach the key, and ${wiktSays}` }
      : { verdict: "no-rhyme", why: `no reading on file; ${form} does not reach the key` };
  }

  const c = compound(word, key, lex);
  if (c) {
    if (lunaticRhythm(c.reading, key)) return { verdict: "out", why: `${c.parts} has the rhythm of ${UNRULED}` };
    return w === false
      ? { verdict: "ask", why: `no reading on file; ${c.parts} would reach the key, and ${wiktSays}` }
      : { verdict: "rhyme", why: `no reading on file; the compound ${c.parts} reaches the key${w ? ", and Wiktionary ends in its sounds" : ""}` };
  }

  if (w === false) return { verdict: "no-rhyme", why: "no reading on file; Wiktionary does not end in the key's sounds" };
  return { verdict: "ask", why: `no reading on file; ${w ? "Wiktionary ends in the key's sounds and does not mark stress" : wiktSays}` };
}
