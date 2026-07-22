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
 * candidate lemmas (most-specific first); the caller takes the first that the
 * prevalence data knows. A richer morphological lemmatiser can replace this
 * without changing the contract.
 */

function dedupe(candidates: string[]): string[] {
  return [...new Set(candidates.filter((c) => c.length > 0))];
}

export function lemmaCandidates(word: string): string[] {
  const w = word.trim().toLowerCase();
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
