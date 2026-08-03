/**
 * Plausible inflectional relatives of a word — the search set a supplement judge
 * looks up in CMUdict when a bare lemma is absent but an inflection carries a
 * usable reading (ADR-0009's derivation seam). It runs both directions:
 *
 *   - forms built *on* the word, treating it as a lemma (`overjoy` → `overjoyed`,
 *     `overjoys`, `overjoying`), so a missing lemma can borrow a present
 *     inflection's reading;
 *   - the base forms *under* the word (`overjoyed` → `overjoy`), reusing the very
 *     rule the engine reduces by.
 *
 * The two directions are asymmetric on purpose. A forward guess invents a form
 * that may not exist, so there is no reading to gate it against and it stays
 * orthographic — a wide, cheap net, and the caller keeps only what the
 * dictionary holds. The backward guess is a claim about a word that *does*
 * exist, and the engine now settles those by sound: a short plural reaches its
 * lemma only when the reading agrees, which is why `ups`, `ins` and `els`
 * stopped propping up their families (#97). So it goes through `Derivation`,
 * and the judge's evidence and the engine's verdict come from one rule rather
 * than two that can disagree about the same word (#105).
 *
 * It never returns the word itself.
 */

import type { Derivation } from "./derivation.ts";

const VOWEL = /[aeiou]/;
const DOUBLES = /[bcdfghjklmnpqrstvwxz]/;

export function inflectionalVariants(word: string, derivation: Derivation): string[] {
  const w = word.trim().toLowerCase();
  const out: string[] = [];
  const add = (v: string) => {
    if (v.length > 1) out.push(v);
  };

  // Forms built on the word (it is the lemma; find its inflections).
  if (w.endsWith("e")) {
    add(w + "s"); // rate -> rates
    add(w + "d"); // rate -> rated
    add(w.slice(0, -1) + "ing"); // rate -> rating
  } else if (w.endsWith("y") && w.length > 2 && !VOWEL.test(w[w.length - 2]!)) {
    add(w.slice(0, -1) + "ies"); // carry -> carries
    add(w.slice(0, -1) + "ied"); // carry -> carried
    add(w + "ing"); // carry -> carrying
  } else {
    add(w + "s"); // overjoy -> overjoys
    add(w + "es"); // church -> churches
    add(w + "ed"); // overjoy -> overjoyed
    add(w + "ing"); // overjoy -> overjoying
    const last = w[w.length - 1]!;
    if (DOUBLES.test(last)) {
      add(w + last + "ed"); // stop -> stopped
      add(w + last + "ing"); // stop -> stopping
    }
  }

  // Base forms under the word (it is an inflection; find its lemma) — under the
  // sound gate, so a base the engine would refuse is never offered as evidence.
  for (const base of derivation.lemmaCandidates(w)) if (base !== w) add(base);

  return [...new Set(out)].filter((v) => v !== w);
}
