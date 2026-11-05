/**
 * Reduce a surface form to its lemma for the knownness lookup only.
 *
 * The prevalence data (ADR-0003) lists ~62k lemmas, not inflected forms: it has
 * `gate`, not `gates`. Without lemmatising before that lookup, every inflected
 * form of every common word would be misfiled as an obscure Bonus Word. This
 * must NOT be applied before rhyme matching — `gate` and `gates` have different
 * Rhyme Keys, and only the surface form is the rhyme the player intended.
 *
 * Rule-based and deliberately conservative. It returns an ordered list of
 * candidate lemmas (the word first, then most-specific first); `knownStem` picks
 * the one its knownness is read from. A richer morphological lemmatiser can
 * replace this without changing the contract.
 *
 * A three-letter `-s` form gets no base here, because on spelling alone it does
 * not deserve one: `Derivation.lemmaCandidates` adds it for the callers that
 * hold readings and can check that it sounds like one. See `derivation.ts` for
 * why — and go through it rather than here whenever readings are available.
 */

import { STEM_EXCEPTIONS } from "./stemExceptions.ts";

/**
 * The candidate a word's knownness is read from, and the value it carries: the
 * word's own row when it has one, and otherwise the best-known candidate stem
 * that has a row (#313). Taking the first stem instead read `plates` as `plat`,
 * `bussed` as `buss` and `cured` as `cur`, filing words everybody knows as Bonus
 * Words. The few stems the best-known one gets wrong are pinned in
 * `stemExceptions.ts`, which `lemmaCandidates` consults before any rule runs.
 *
 * `candidates` is a `lemmaCandidates` list, so its first entry is the word.
 * `valueOf` is whatever the caller reads knownness from: the built prevalence,
 * or measured prevalence with the standing verdicts layered over it. Every walk
 * that tiers a word goes through here, so they cannot disagree on which stem wins.
 */
export function knownStem(
  candidates: readonly string[],
  valueOf: (candidate: string) => number | undefined,
): { stem: string; value: number } | null {
  const [word, ...stems] = candidates;
  if (word === undefined) return null;
  const own = valueOf(word);
  if (own !== undefined) return { stem: word, value: own };
  let best: { stem: string; value: number } | null = null;
  for (const stem of stems) {
    const value = valueOf(stem);
    // Strictly greater, so a tie goes to the more specific stem, listed first.
    if (value !== undefined && (best === null || value > best.value)) best = { stem, value };
  }
  return best;
}

function dedupe(candidates: string[]): string[] {
  return [...new Set(candidates.filter((c) => c.length > 0))];
}

export function lemmaCandidates(word: string): string[] {
  const w = word.trim().toLowerCase();
  // A stem exception names the one stem the word reads as, and no rule runs.
  const excepted = STEM_EXCEPTIONS.get(w);
  if (excepted !== undefined) return [w, excepted];
  const candidates = [w];

  // plural / third-person: -ies -> -y, -es, -s
  if (w.endsWith("ies") && w.length > 4) candidates.push(w.slice(0, -3) + "y");
  if (w.endsWith("es") && w.length > 3) candidates.push(w.slice(0, -2));
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) candidates.push(w.slice(0, -1));

  // past / progressive: -ied -> -y, -ed, -ing, with de-doubling and +e restore
  if (w.endsWith("ied") && w.length > 4) candidates.push(w.slice(0, -3) + "y");
  if (w.endsWith("ed") && w.length > 3) {
    candidates.push(w.slice(0, -2)); // walked -> walk
    candidates.push(w.slice(0, -1)); // waded -> wade
  }
  // -ying -> -ie first, the more specific rule: dying is `die`, not `dye` (#240)
  if (w.endsWith("ying") && w.length > 4) candidates.push(w.slice(0, -4) + "ie");
  if (w.endsWith("ing") && w.length > 4) {
    candidates.push(w.slice(0, -3)); // walking -> walk
    candidates.push(w.slice(0, -3) + "e"); // rating -> rate
  }

  // de-double a final consonant (stopped -> stop, running -> run)
  for (const base of [...candidates]) {
    if (/([bcdfghjklmnpqrstvwxz])\1$/.test(base)) {
      candidates.push(base.slice(0, -1));
    }
  }

  return dedupe(candidates);
}
