/**
 * What the Editor's Pass asks about a list of words, and what it gets back:
 * **facts about each word, never a verdict about it** (#189).
 *
 * ## Why the wire carries evidence rather than buckets
 *
 * Wordhood, name status, readings, composition and knownness are Node-only —
 * they live in `data/cmudict.dict`, `data/words.txt`, `data/names.txt` and
 * `data/prevalence.csv`, and no module under `web/src/` has ever opened one. So
 * something has to cross the line. What crosses is the evidence, and the
 * grouping stays in the browser, for four reasons that are all the same reason:
 *
 * - **The vocabulary already exists and already crosses here.** `WordEvidence`
 *   is `src/supplementEvidence.ts`'s, `addOutcome.ts` already imports two of its
 *   members into the browser, and it carries every fact this feature needs bar
 *   one. {@link WordFacts} is that type plus a number, not a parallel set.
 * - **It makes the join genuinely pure.** Two adapters satisfy this shape — the
 *   endpoint, and a hand-built literal in a test — which is what lets
 *   `pastedList.ts` be text-and-facts in, buckets out, with no browser and no
 *   fixture server anywhere near it.
 * - **Buckets would not hold still.** #190, #191 and #192 each change how the
 *   residue is grouped and acted on. A bucket wire type would make every one of
 *   those a change to a contract Node and the browser both had to agree about.
 *   A fact about a word does not move.
 * - **It is the prior art.** `dayCandidates.ts` selects out of a server readout
 *   and `disagreement.ts` derives in the browser: the server answers with what
 *   is true, the browser decides what to make of it.
 *
 * ## Why the shapes are declared here
 *
 * `addOutcome.ts`'s reason, in both directions at once. The browser cannot
 * import the module that *assembles* a reply — it reads files — so the reply
 * shape is written on this side and `web/editorEvidencePlugin.ts` imports it
 * back. The request shape is written here for the plainer reason that the
 * browser is what builds one. Two declarations of one wire shape is exactly the
 * pair that drifts.
 */

import type { RhymeKey } from "../../../src/phonology.ts";
import type { WordEvidence } from "../../../src/supplementEvidence.ts";

/**
 * Everything true of one word against the day's Rhyme Key.
 *
 * `WordEvidence` and one number. Knownness is the addition because
 * `EvidenceContext` carries no prevalence at all — it is assembled from the
 * pronunciation map, the word list and the names, and the norms are a fourth
 * file read beside it.
 */
export interface WordFacts extends WordEvidence {
  /**
   * The word's own prevalence row, or `null` when it has none.
   *
   * **It orders and never admits.** A word with no row already resolves to a
   * Bonus Word in the Rhyme Index (ADR-0003), so treating a missing row as a
   * reason to drop a word would silently hide exactly the legitimate Bonus
   * Words this tool exists to surface. `pastedList.ts` sorts on it and nothing
   * anywhere filters on it.
   *
   * The word's own row and never a lemma's, matching what the day readout puts
   * behind each of its words and what ADR-0015 reads as "the word had no
   * prevalence row at all".
   */
  knownness: number | null;
}

/**
 * What one lookup asks: a Rhyme Key, and the words to hold against it.
 *
 * **One key, never a set.** That is ADR-0014's measured boundary rather than a
 * convenience — composing against a single target is 0.12% wrong and composing
 * against the 260 scheduled ones is 62.0% wrong — and it is stated in the
 * request shape so that widening it would have to be a deliberate edit here.
 */
export interface EvidenceRequest {
  rhymeKey: RhymeKey;
  words: string[];
}

/**
 * What the lookup answers with: the key it was held against, and one record per
 * word asked about, in the order they were asked.
 *
 * The key travels back because the caller's may have moved while the request was
 * in flight — the editor changes the date, or an add rebuilds the index and the
 * day is re-read — and evidence gathered against yesterday's key would mark the
 * wrong words as resolvable. The browser compares rather than assumes.
 */
export interface EvidenceReply {
  rhymeKey: RhymeKey;
  words: WordFacts[];
}
