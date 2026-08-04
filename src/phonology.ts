/**
 * Phonology primitives: phonemes, pronunciations, and the Rhyme Key.
 *
 * A phoneme is a CMUdict ARPABET symbol. Vowels carry a trailing stress digit:
 * `0` unstressed, `1` primary, `2` secondary (ADR-0001). Consonants carry none.
 *
 * The Rhyme Key is the sequence of *sounds* from a word's last stressed vowel
 * (primary or secondary) to the end of the word, with stress digits stripped —
 * stress locates the key's start but is not itself part of the key, so that
 * `ate` (EY1 T) and `impregnate` (... N EY2 T) share the key `EY T`.
 */

export type Phoneme = string;
export type Pronunciation = Phoneme[];

/** A normalised, comparable Rhyme Key, e.g. "EY T". */
export type RhymeKey = string;

/** True for an ARPABET vowel, i.e. a symbol ending in a stress digit 0/1/2. */
export function isVowel(phoneme: Phoneme): boolean {
  return /[0-2]$/.test(phoneme);
}

/**
 * ARPABET's fixed vowel symbols, bare (no stress digit). `isVowel` above
 * answers the same question for a live phoneme, but needs a stress digit to
 * do it — a Rhyme Key strips every digit, vowels included, so a caller
 * working from key strings alone (`schwaTwins.ts`) has nothing for `isVowel`
 * to read and must ask by symbol instead.
 */
const VOWEL_SOUNDS = new Set([
  "AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW",
]);

/** True for an ARPABET vowel symbol with its stress digit already stripped. */
export function isVowelSound(sound: Phoneme): boolean {
  return VOWEL_SOUNDS.has(sound);
}

/** The stress digit of a vowel phoneme (0/1/2), or null for a consonant. */
export function stressOf(phoneme: Phoneme): 0 | 1 | 2 | null {
  const match = phoneme.match(/([0-2])$/);
  if (!match) return null;
  return Number(match[1]) as 0 | 1 | 2;
}

/** Strip the stress digit from a phoneme, leaving the bare sound. */
export function bareSound(phoneme: Phoneme): Phoneme {
  return phoneme.replace(/[0-2]$/, "");
}

/**
 * Swap a phoneme's sound while keeping its stress: `withSound("AO1", "AA")` is
 * `"AA1"`. The counterpart to `bareSound` — one reads the sound off, this writes
 * a new one back without disturbing what the stress digit locates.
 */
export function withSound(phoneme: Phoneme, sound: Phoneme): Phoneme {
  return sound + (phoneme.match(/[0-2]$/)?.[0] ?? "");
}

/**
 * Swap a vowel's stress while keeping its sound: `withStress("UW0", 2)` is
 * `"UW2"`. The other counterpart to `bareSound` — `withSound` rewrites what a
 * phoneme sounds like, this rewrites how loudly it is said. Call it on a vowel:
 * a consonant carries no stress digit, so stressing one is meaningless.
 */
export function withStress(phoneme: Phoneme, stress: 0 | 1 | 2): Phoneme {
  return bareSound(phoneme) + String(stress);
}

/**
 * The Rhyme Key of a single pronunciation: scan back to the last vowel marked
 * primary or secondary, then take every phoneme from there to the end with
 * stress digits removed. Returns null if the pronunciation has no stressed
 * vowel (e.g. a bare function word), which cannot anchor a rhyme.
 */
export function rhymeKeyOf(pronunciation: Pronunciation): RhymeKey | null {
  let start = -1;
  for (let i = pronunciation.length - 1; i >= 0; i--) {
    const stress = stressOf(pronunciation[i]!);
    if (stress === 1 || stress === 2) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  return pronunciation
    .slice(start)
    .map(bareSound)
    .join(" ");
}
