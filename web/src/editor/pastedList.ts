/**
 * The join: a third-party rhyme list, pasted, held against the day's Puzzle.
 *
 * Every Editor's Pass used to end in a manual join — the editor reads one word
 * off a rhyme list in another window, scans the day's Answers for it, repeats,
 * 274 times for the `idiotic` Puzzle (#186). This is that scan, done here: the
 * paste goes in, everything the day already covers collapses to a count, and
 * what is left is the residue — the words the day may be missing.
 *
 * ## What a paste is, and is not
 *
 * It supplies **candidate spellings, never verdicts**. A word does not become an
 * Answer because a third party says it rhymes; third-party lists omit real words
 * and include ones we would refuse, so a pasted word is one more nomination and
 * nothing more. Nothing in this module writes anything, adjudicates anything, or
 * assigns a Tier — the Answer/Bonus Word split stays a property of the word
 * (ADR-0003, ADR-0015) and the editor is never offered a lever over it.
 *
 * ## Why the residue is not yet grouped
 *
 * This slice (#188) is the join and only the join: the by-eye scan replaced, and
 * a plain list of what survives it. Splitting that residue on wordhood, ordering
 * it by knownness and acting on it need evidence the browser does not have here
 * — wordhood, prevalence, composition — and arrive with the seam that fetches
 * them (#189 onward). The buckets grow; the join does not move.
 *
 * ## What it joins against
 *
 * The readout's own two lists — the day as the built index reads it, which is
 * the day the tool is a read of. Deliberately not the Corrected Day: a word the
 * editor has demoted is gone from the Puzzle at the next rebuild,
 * and counting it as covered is the conservative side of that gap — it keeps the
 * tool from offering back, as missing, a word the editor has just refused in
 * this sitting.
 */

import { normaliseWord } from "../../../src/cmudict.ts";
import type { DayReadout } from "../../../scripts/editorDay.ts";
import { isWord } from "./add.ts";

/**
 * Entries are separated by newlines, commas and tabs — never by spaces.
 *
 * That distinction is the whole of how a phrase stays detectable: splitting on
 * whitespace would turn `hard hat` into two admissible words rather than one
 * entry to drop, and the measured `idiotic` paste held three phrases among its
 * 274 entries. A list copied one-per-line and a list copied comma-separated both
 * land the same way.
 *
 * The cost is real and the panel carries it rather than this module: a list
 * copied space-separated arrives as one enormous entry, fails the word shape,
 * and joins to nothing at all. That is indistinguishable here from an empty box,
 * so the view is what tells the editor which of the two happened.
 */
const SEPARATORS = /[\n\r,\t]+/;

/** A paste, held against one day. */
export interface PastedList {
  /** How many distinct words the paste held, once the noise was dropped. */
  pasted: number;
  /** How many of those the day already covers, as Answers or as Bonus Words. */
  covered: number;
  /**
   * The rest — pasted words the day holds in neither list — in the order the
   * pasted list gave them. Not a claim that any of them belongs in the Puzzle:
   * a residue word may have no wordhood, no reading, or no rhyme on our own.
   */
  residue: string[];
}

/**
 * Join a pasted rhyme list against the day on screen.
 *
 * **Total, and never null.** An empty paste, a paste of pure noise and a date
 * the schedule does not cover are three different facts, but the caller
 * distinguishes them from the readout and the box's own contents rather than
 * from a shape returned here.
 *
 * A readout that is not a scheduled day has no Puzzle and no Rhyme Key, so it
 * joins to nothing: the words are held in the box, unspent, and the join runs
 * again the moment a day is on screen. Returning the paste as residue instead
 * would be asserting that a day with no Answers is missing all of them.
 *
 * Uncapped by design. The editor controls the volume by what they select.
 */
export function joinPastedList(text: string, readout: DayReadout | null): PastedList {
  if (readout === null || readout.outcome !== "day") {
    return { pasted: 0, covered: 0, residue: [] };
  }

  // Both sides of the comparison go through `normaliseWord`, so the join can
  // never turn on a casing difference between a third party's spelling and the
  // index's. The index's are already lower-cased; this is what keeps the match
  // from depending on that staying true.
  const covered = new Set<string>();
  for (const entry of readout.answers) covered.add(normaliseWord(entry.word));
  for (const entry of readout.bonusWords) covered.add(normaliseWord(entry.word));

  let counted = 0;
  const residue: string[] = [];
  for (const word of pastedWords(text)) {
    counted += 1;
    if (!covered.has(word)) residue.push(word);
  }

  return { pasted: counted, covered: counted - residue.length, residue };
}

/**
 * The distinct words a paste holds, in first-seen order.
 *
 * Everything dropped here is dropped **silently**: a phrase, a hyphenated entry,
 * an affix fragment like `-otic` and a stray `¹` are all formatting noise from a
 * page the editor copied rather than words they nominated, and a bucket of them
 * would be a bucket nobody ever acts on. A duplicate is absorbed for a plainer
 * reason — the same word twice is the same nomination twice.
 */
function* pastedWords(text: string): Generator<string> {
  const seen = new Set<string>();
  for (const entry of text.split(SEPARATORS)) {
    const word = normaliseWord(entry);
    if (!isWord(word)) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    yield word;
  }
}
