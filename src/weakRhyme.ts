/**
 * The **Weak Rhyme** test (GLOSSARY.md, ADR-0020 as amended on #232): the one
 * place the line between "accepted without Points" and "rejected" is drawn.
 *
 * Two words are a Weak Rhyme when, on some reading of each, their last
 * syllables have the same rime, that syllable is stressed in one word and
 * unstressed in the other, and the shared rime is a vowel actually said plus at
 * least one consonant after it. The adjudicator asks this only of a word that is
 * already no Rhyme, so this test never has to tell the two apart.
 *
 * **The line is provisional.** Three lines were tried on #232 and each put words
 * on both sides of the maintainer's ear. Nothing else reads where it falls:
 * Score, Rank and Difficulty do not move, no Judge is asked, and the verdict is
 * worked out at submission. So moving it is a change to this file alone.
 *
 * It reads the weak vowel **as the dictionary wrote it**, from
 * `RhymeIndex.unmergedReadingsOf`, and not through the Normalisation that reads
 * weak "ih" and weak "uh" as one sound (#260). That keeps a fault #232 accepted:
 * `aspirin` for `win` is a Weak Rhyme and `muffin` for `win` is not.
 */

import { bareSound, isStressed, isVowel, stressOf, type Pronunciation } from "./phonology.ts";

/** The weak vowel that drops out before `l`, `m` or `n` (`delusion` is "zh'n"). */
const MURMURED_VOWEL = "AH";
const MURMURING_CONSONANTS = new Set(["L", "M", "N"]);

/** A reading's last syllable: its rime, as bare sounds, and whether it is stressed. */
interface LastSyllable {
  rime: string;
  stressed: boolean;
}

/**
 * The last syllable of a reading, or null when it cannot carry a Weak Rhyme:
 * no vowel, no consonant after the vowel, or a vowel that is not said.
 */
function lastSyllable(reading: Pronunciation): LastSyllable | null {
  let at = -1;
  for (let i = reading.length - 1; i >= 0; i--) {
    if (isVowel(reading[i]!)) {
      at = i;
      break;
    }
  }
  if (at === -1) return null;
  const vowel = reading[at]!;
  const coda = reading.slice(at + 1);
  if (coda.length === 0) return null;
  const murmured =
    bareSound(vowel) === MURMURED_VOWEL && stressOf(vowel) === 0 && MURMURING_CONSONANTS.has(coda[0]!);
  if (murmured) return null;
  return { rime: [bareSound(vowel), ...coda].join(" "), stressed: isStressed(vowel) };
}

/**
 * True if some reading of the Seed Word and some reading of the Submission are
 * a Weak Rhyme. Symmetric: the arguments may be given in either order.
 *
 * `seedReadings` must be the Seed Word's pinned readings only, since a Seed
 * Word is heard one way; `submissionReadings` may be every reading the word has.
 */
export function isWeakRhyme(
  seedReadings: readonly Pronunciation[],
  submissionReadings: readonly Pronunciation[],
): boolean {
  const theirs = submissionReadings.map(lastSyllable).filter((s) => s !== null);
  return seedReadings.some((reading) => {
    const ours = lastSyllable(reading);
    return ours !== null && theirs.some((s) => s.rime === ours.rime && s.stressed !== ours.stressed);
  });
}
