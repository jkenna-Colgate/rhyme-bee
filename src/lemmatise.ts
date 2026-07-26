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

/**
 * Common derivational prefixes (ADR-0008). Deliberately short: a prefix only
 * counts when it strips down to a real base word, so a longer list buys little
 * and risks stripping a native word to a coincidental base.
 */
const DERIVATIONAL_PREFIXES = [
  "un", "re", "out", "over", "mis", "non", "under", "inter",
];

/**
 * True if `word` is a regular inflection of some *other* dictionary word — the
 * inflectional bases `lemmaCandidates` already yields, kept only when the
 * dictionary actually holds one. The word standing in for its own base (a word
 * that is its own only candidate) is not an inflection.
 */
function isInflection(word: string, isWord: (w: string) => boolean): boolean {
  return lemmaCandidates(word).some((base) => base !== word && isWord(base));
}

/**
 * True if `word` is *derived* — a regular inflection (`-s/-es/-ies/-ed/-ing`) or
 * a common-prefix affixation (`un-/re-/out-/…`) of a dictionary word (ADR-0008).
 * A word that is neither is *native*: it carries rhyme content of its own, and
 * only native content makes a Rhyme Key eligible to be a Seed.
 *
 * Both passes are required. Suffix stripping alone lets `unaided`/`outstanding`
 * masquerade as native, so the shadow keys they sit in wrongly survive. A prefix
 * counts only when what remains is itself a real word or an inflection of one, so
 * a prefix that merely happens to start a native word — the `re` in `read` — is
 * not a false positive.
 */
export function isDerived(word: string, isWord: (w: string) => boolean): boolean {
  const w = word.trim().toLowerCase();
  if (isInflection(w, isWord)) return true;
  for (const prefix of DERIVATIONAL_PREFIXES) {
    if (!w.startsWith(prefix)) continue;
    const base = w.slice(prefix.length);
    if (base.length < 2) continue;
    if (isWord(base) || isInflection(base, isWord)) return true;
  }
  return false;
}
