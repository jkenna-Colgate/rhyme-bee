/**
 * Turn an ARPABET pronunciation into a plain-English respelling a player can
 * read without training (story 20), with the stressed syllable upper-cased so
 * the stress rule is visible rather than merely asserted (story 21).
 *
 * This is a readability aid, not a phonetic transcription — it is intentionally
 * approximate. It is deterministic and never contains phonetic symbols.
 */

import { bareSound, isVowel, stressOf, type Pronunciation } from "./phonology.ts";

const SOUND: Record<string, string> = {
  // vowels
  AA: "ah", AE: "a", AH: "uh", AO: "aw", AW: "ow", AY: "eye",
  EH: "eh", ER: "ur", EY: "ay", IH: "ih", IY: "ee",
  OW: "oh", OY: "oy", UH: "uu", UW: "oo",
  // consonants
  B: "b", CH: "ch", D: "d", DH: "th", F: "f", G: "g", HH: "h",
  JH: "j", K: "k", L: "l", M: "m", N: "n", NG: "ng", P: "p",
  R: "r", S: "s", SH: "sh", T: "t", TH: "th", V: "v", W: "w",
  Y: "y", Z: "z", ZH: "zh",
};

function graphemeFor(phoneme: string): string {
  return SOUND[bareSound(phoneme)] ?? bareSound(phoneme).toLowerCase();
}

/**
 * Respell a pronunciation, grouping sounds into rough syllables (one per vowel)
 * and upper-casing the syllable that carries primary stress.
 */
export function respell(pronunciation: Pronunciation): string {
  const syllables: { text: string; stress: number }[] = [];
  let current = "";
  let currentStress = 0;

  const flush = () => {
    if (current !== "") syllables.push({ text: current, stress: currentStress });
    current = "";
    currentStress = 0;
  };

  for (const phoneme of pronunciation) {
    current += graphemeFor(phoneme);
    if (isVowel(phoneme)) {
      currentStress = stressOf(phoneme) ?? 0;
      flush();
    }
  }
  flush();

  if (syllables.length === 0) return "";

  // Prefer the primary-stressed syllable; fall back to the last stressed one.
  let stressedIndex = syllables.findIndex((s) => s.stress === 1);
  if (stressedIndex === -1) {
    for (let i = syllables.length - 1; i >= 0; i--) {
      if (syllables[i]!.stress === 2) {
        stressedIndex = i;
        break;
      }
    }
  }

  return syllables
    .map((s, i) => (i === stressedIndex ? s.text.toUpperCase() : s.text))
    .join("-");
}
