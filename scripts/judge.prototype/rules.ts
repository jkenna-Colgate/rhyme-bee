/**
 * PROTOTYPE, throwaway (#231). The rules #232 settled, applied by machine, so a
 * label follows the rules and the maintainer is shown only the pairs the rules
 * cannot decide.
 *
 * The question is Points only: is this pair a Rhyme, given the right reading. A
 * Weak Rhyme is never asked about; here it is simply "no Points".
 *
 * The two Normalisations #232 decided are not built, so they are applied here:
 * the engine still rejects pairs these rules accept (`utility` for `facility`,
 * `higher` for `expire`).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bareSound, isVowel, isVowelSound, rhymeKeyOf, stressOf, type Pronunciation, type RhymeKey } from "../../src/phonology.ts";
import type { Pair } from "./pool.ts";

const root = resolve(import.meta.dirname, "../..");

// ---- the two Normalisations and the hand-written readings ------------------

const GLIDE = new Set(["AY", "AW", "OY"]);
const L_DROP = new Set(["AY", "OW", "UW", "AW", "OY"]);

/** After "eye", "ow" or "oy", "er" and plain `r` are read as each other, in both directions. */
function rVariants(p: Pronunciation): Pronunciation[] {
  const out: Pronunciation[] = [];
  for (let i = 0; i + 1 < p.length; i++) {
    const a = p[i]!, b = p[i + 1]!, c = p[i + 2];
    if (!isVowel(a) || stressOf(a) === 0 || !GLIDE.has(bareSound(a))) continue;
    if (b === "ER0") out.push([...p.slice(0, i + 1), "R", ...p.slice(i + 2)]);
    if (b === "R" && !(c && isVowel(c))) out.push([...p.slice(0, i + 1), "ER0", ...p.slice(i + 2)]);
  }
  return out;
}

/** The seventeen plain `-s` and `-ed` forms the shipped syllabic consonant rule misses (`dialed`, `fuels`, `vials`). */
function lVariants(p: Pronunciation): Pronunciation[] {
  const n = p.length;
  if (n < 4 || !["Z", "D"].includes(p[n - 1]!) || p[n - 2] !== "L" || p[n - 3] !== "AH0") return [];
  const v = p[n - 4]!;
  return isVowel(v) && stressOf(v) !== 0 && L_DROP.has(bareSound(v)) ? [[...p.slice(0, n - 3), ...p.slice(n - 2)]] : [];
}

const HAND: Record<string, { replace: boolean; readings: string[] }> = {
  gruel: { replace: false, readings: ["G R UW1 L"] },
  skier: { replace: true, readings: ["S K IY1 ER0"] },
  noir: { replace: true, readings: ["N W AA1 R"] },
  boudoir: { replace: true, readings: ["B UW0 D W AA1 R"] },
};

/** A word's readings as the rules read them: the engine's, plus what #232 decided and nobody has built. */
export function ruleReadings(word: string, readings: Pronunciation[]): Pronunciation[] {
  const hand = HAND[word];
  const base = hand?.replace ? [] : [...readings];
  for (const r of hand?.readings ?? []) base.push(r.split(" "));
  return [...base, ...base.flatMap((p) => [...rVariants(p), ...lVariants(p)])];
}

/** Weak "ih" and weak "uh" are one sound after the stressed vowel of a Rhyme Key. */
export const canon = (key: RhymeKey): RhymeKey => key.split(" ").map((s, i) => (i > 0 && s === "IH" ? "AH" : s)).join(" ");

export function ruleKeys(word: string, readings: Pronunciation[]): Set<RhymeKey> {
  return new Set(ruleReadings(word, readings).map(rhymeKeyOf).filter((k): k is RhymeKey => !!k).map(canon));
}

/** Why a reading the engine rejects reaches the key under the rules, or null when it does not. */
export function reachesBy(word: string, readings: Pronunciation[], key: RhymeKey): string | null {
  const keys = readings.map(rhymeKeyOf);
  if (keys.includes(key)) return "the engine's reading";
  if (keys.some((k) => k && canon(k) === canon(key))) return "the weak-vowel Normalisation";
  if (ruleKeys(word, readings).has(canon(key))) return HAND[word] ? "a hand-written reading" : "the r rule, or one of the 17 -s and -ed readings";
  return null;
}

// ---- the shapes the rules name ---------------------------------------------

const sounds = (p: Pronunciation) => p.map(bareSound);
const vowelsAt = (p: Pronunciation) => p.flatMap((x, i) => (isVowel(x) ? [i] : []));
const WEAK_CAPABLE = new Set(["IH", "AH", "ER"]);

/** The last syllable's rime is the key, and the stress falls earlier: at most a Weak Rhyme, so no Points. */
export function matchesUnstressed(reading: Pronunciation, key: RhymeKey): boolean {
  if (key.split(" ").filter(isVowelSound).length !== 1) return false;
  const v = vowelsAt(reading);
  if (!v.length || rhymeKeyOf(reading) === key) return false;
  return sounds(reading.slice(v[v.length - 1]!)).join(" ") === key;
}

/**
 * The shape #232 did not rule (`lunatic`, `heretic`, `maverick`, `synonym`): a
 * weak-capable vowel in the last syllable, with an unstressed syllable between
 * it and the stress. Whether the last syllable carries a secondary stress is
 * what #233 is deciding, so no label is written and no judge is asked.
 */
export function disputedShape(reading: Pronunciation, key: RhymeKey): boolean {
  const parts = key.split(" ");
  if (parts.filter(isVowelSound).length !== 1 || !WEAK_CAPABLE.has(parts[0]!)) return false;
  const v = vowelsAt(reading);
  if (v.length < 3) return false;
  const last = v[v.length - 1]!, penult = v[v.length - 2]!;
  return sounds(reading.slice(last)).join(" ") === key && stressOf(reading[penult]!) === 0;
}

// ---- the second dictionary -------------------------------------------------

const IPA: Record<string, string> = {
  ɪ: "IH", ə: "AH", i: "IY", ɛ: "EH", æ: "AE", ʊ: "UH", ɑ: "AA", ɒ: "AA", ɔ: "AO", ʌ: "AH", u: "UW", ɚ: "ER", ɝ: "ER", ɜ: "ER",
  o: "OW", e: "EY", a: "AA", ɨ: "IH", ᵻ: "IH", ɘ: "IH", ɐ: "AH", ʉ: "UW",
  n: "N", t: "T", ɹ: "R", s: "S", l: "L", k: "K", m: "M", d: "D", p: "P", b: "B", f: "F", z: "Z", ɡ: "G", v: "V", ʃ: "SH",
  ŋ: "NG", j: "Y", w: "W", h: "HH", "d͡ʒ": "JH", "t͡ʃ": "CH", θ: "TH", ð: "DH", ʒ: "ZH", ɾ: "T", ʍ: "W", ɫ: "L", ʔ: "T", x: "K",
};
const JOIN: Record<string, string> = { "AA IH": "AY", "AA UH": "AW", "EY IH": "EY", "OW UH": "OW", "AO IH": "OY", "AH UH": "OW" };

/** One Wiktionary reading as bare sounds, or null when it holds a segment this crude table does not know. */
function ipaToSounds(ipa: string): string[] | null {
  const out: string[] = [];
  let glided = false;
  for (const raw of ipa.trim().split(" ")) {
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
function norm(s: string[]): string[] {
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

const wikt = new Map<string, string[][]>();
for (const line of readFileSync(resolve(root, ".scratch/judge/wikipron_us.tsv"), "utf8").split("\n")) {
  const [w, ipa] = line.split("\t");
  if (!w || !ipa || !/^[a-z]+$/.test(w)) continue;
  const s = ipaToSounds(ipa);
  if (s) wikt.set(w, [...(wikt.get(w) ?? []), norm(s)]);
}

/** Does any Wiktionary reading end in the key's sounds? Stress is not in the file, so this can refute a Rhyme and never prove one. */
export function wiktEndsIn(word: string, key: RhymeKey): boolean | null {
  const readings = wikt.get(word);
  if (!readings) return null;
  const k = norm(key.split(" "));
  const same = (a: string, b: string, i: number) => a === b || (i > 0 && ["IH", "AH"].includes(a) && ["IH", "AH"].includes(b));
  return readings.some((r) => r.length >= k.length && k.every((x, i) => same(r[r.length - k.length + i]!, x, i)));
}

// ---- the decision ----------------------------------------------------------

export type RuleVerdict = "rhyme" | "no-rhyme" | "ask" | "out";
export interface Decision { verdict: RuleVerdict; why: string }
export interface Lexicon {
  pronunciations: ReadonlyMap<string, Pronunciation[]>;
  words: ReadonlySet<string>;
  /** In the Answer band. The word list also holds `lish`, `kish` and `rick`, which split `abolish`, `bookish` and `derrick`. */
  known: (word: string) => boolean;
}

/**
 * Stress marks no ticket has settled, by name: the seven words the said-back
 * test left open (#235) and the seven it has not been run on (#237). Two of
 * them have two syllables, so the shape test below does not catch them.
 */
const NOT_RULED = new Set([
  "counterfeit", "gimmick", "anarchist", "maverick", "apocalypse", "derelict", "walnut",
  "acronym", "asterisk", "benefit", "mannequin", "rhetoric", "catapult", "labyrinth",
]);

/** Wiktionary reads the word as one syllable ending in a one-syllable key: the only reading in the file whose stress is not in doubt. */
function wiktProves(word: string, key: RhymeKey): boolean {
  const k = norm(key.split(" "));
  if (k.filter(isVowelSound).length !== 1 || !wiktEndsIn(word, key)) return false;
  return (wikt.get(word) ?? []).some((r) => r.filter(isVowelSound).length === 1 && r.slice(-k.length).join(" ") === k.join(" "));
}

const SIBILANT = new Set(["S", "Z", "SH", "ZH", "CH", "JH"]);
const VOICELESS = new Set(["P", "T", "K", "F", "TH", "S", "SH", "CH"]);
const doubles = (stem: string) => /[^aeiou][aeiou][^aeiouwxy]$/.test(stem);

/**
 * The reading of a regular -s, -ed or -ing form whose stem is a word with a
 * reading. English adds these endings without moving the stress, so the form's
 * reading follows from the stem's. Both weak vowels are written, since the
 * dictionary writes the ending both ways.
 */
function inflected(word: string, lex: Lexicon): { stem: string; readings: Pronunciation[] } | null {
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
    const prons = lex.pronunciations.get(stem);
    if (stem.length < 2 || !lex.words.has(stem) || !prons?.length) continue;
    // `tares` is tare + s, never tar + es: -es follows a hiss or an o.
    if (form === "s" && stem + "es" === word && !stem.endsWith("o") && !prons.some((p) => SIBILANT.has(p[p.length - 1]!))) continue;
    const readings = prons.flatMap((p) => {
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
function compound(word: string, key: RhymeKey, lex: Lexicon): { parts: string; reading: Pronunciation } | null {
  for (let i = 3; i <= word.length - 4; i++) {
    const head = word.slice(0, i), tail = word.slice(i);
    if (!lex.known(head) || !lex.known(tail)) continue;
    const h = lex.pronunciations.get(head)?.[0];
    const t = ruleReadings(tail, lex.pronunciations.get(tail) ?? []).find((p) => { const k = rhymeKeyOf(p); return !!k && canon(k) === canon(key); });
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

export function decide(p: Pair, lex: Lexicon): Decision {
  if (p.kind === "tier") return { verdict: "out", why: "a Tier question, not a question about sound" };
  if (!p.evidence.isWord) return { verdict: "out", why: "a wordhood question: not on the word list, so it has no right reading to rule on" };
  if (NOT_RULED.has(p.word)) return { verdict: "out", why: "a stress mark no ticket has settled" };

  const key = p.rhymeKey;
  const oneSyllable = key.split(" ").filter(isVowelSound).length === 1;
  const w = wiktEndsIn(p.word, key);
  const wiktSays = w === null ? "Wiktionary has no entry" : w ? "Wiktionary ends in the key's sounds" : "Wiktionary does not end in the key's sounds";
  const engine = p.evidence.readings.map((r) => r.phonemes.split(" "));

  if (engine.length) {
    const by = reachesBy(p.word, engine, key);
    if (by) return { verdict: "rhyme", why: `reaches the key by ${by}` };
    if (engine.some((r) => matchesUnstressed(r, key))) {
      if (engine.some((r) => disputedShape(r, key))) return { verdict: "out", why: UNRULED };
      const c = compound(p.word, key, lex);
      if (c) return { verdict: "ask", why: `the dictionary marks no stress on the last syllable, and the spelling splits as ${c.parts}: a compound missing a mark is a missing reading` };
      return { verdict: "no-rhyme", why: "the last syllable matches and is unstressed: no Points" };
    }
    if (w !== true) return { verdict: "no-rhyme", why: w === false ? "two dictionaries agree it does not reach the key" : "the engine's reading does not reach the key, and Wiktionary has no entry" };
    // The syllabic consonant rule appends a reading with no last vowel (`basin` as B EY1 S N); the fullest reading is the one to ask.
    const most = Math.max(...engine.map((r) => vowelsAt(r).length));
    const lastUnstressed = most > 1 && engine.filter((r) => vowelsAt(r).length === most).every((r) => stressOf(r[vowelsAt(r)[most - 1]!]!) === 0);
    if (oneSyllable && lastUnstressed) {
      const asWikt = engine.filter((r) => vowelsAt(r).length === most).map((r) => [...r.slice(0, vowelsAt(r)[most - 1]!), ...key.split(" ").map((x, i) => (i === 0 ? `${x}0` : x))]);
      if (asWikt.some((r) => disputedShape(r, key))) return { verdict: "out", why: UNRULED };
      return { verdict: "no-rhyme", why: "the dictionaries differ on the last vowel, and the last syllable is unstressed either way: no Points" };
    }
    return { verdict: "ask", why: "the engine's reading does not reach the key, and Wiktionary's ends in its sounds" };
  }

  if (wiktProves(p.word, key)) return { verdict: "rhyme", why: "no reading on file; Wiktionary reads it as one syllable ending in the key" };

  const inf = inflected(p.word, lex);
  if (inf) {
    const form = `the regular form of ${inf.stem}`;
    if (ruleKeys(p.word, inf.readings).has(canon(key))) {
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

  const c = compound(p.word, key, lex);
  if (c) {
    if (lunaticRhythm(c.reading, key)) return { verdict: "out", why: `${c.parts} has the rhythm of ${UNRULED}` };
    return w === false
      ? { verdict: "ask", why: `no reading on file; ${c.parts} would reach the key, and ${wiktSays}` }
      : { verdict: "rhyme", why: `no reading on file; the compound ${c.parts} reaches the key${w ? ", and Wiktionary ends in its sounds" : ""}` };
  }

  if (w === false) return { verdict: "no-rhyme", why: "no reading on file; Wiktionary does not end in the key's sounds" };
  return { verdict: "ask", why: `no reading on file; ${w ? "Wiktionary ends in the key's sounds and does not mark stress" : wiktSays}` };
}

// ---- the substitution property ---------------------------------------------

/**
 * Make any Answer the Seed Word and the Puzzle holds the same words. Over a
 * label set that means: within one Rhyme Key every "rhyme" is one family, so a
 * word cannot be a Rhyme for one member and not for another. Returns each word
 * labelled both ways against the same key.
 */
export function substitutionBreaks(labels: { word: string; rhymeKey: RhymeKey; label: string }[]): string[] {
  const seen = new Map<string, Set<string>>();
  for (const l of labels) {
    if (l.label !== "rhyme" && l.label !== "no-rhyme") continue;
    const id = `${l.word} on ${canon(l.rhymeKey)}`;
    (seen.get(id) ?? (seen.set(id, new Set()), seen.get(id)!)).add(l.label);
  }
  return [...seen].filter(([, s]) => s.size > 1).map(([id]) => id);
}
