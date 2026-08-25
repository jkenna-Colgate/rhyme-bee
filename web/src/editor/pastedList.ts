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
 * ## What splits the residue, and what only orders it
 *
 * **Wordhood admits; knownness orders** (#189). A pasted word that is in
 * `data/words.txt` is admissible, and what its prevalence row says decides only
 * where in the pile it sits — because a word with no row already resolves to a
 * Bonus Word in the Rhyme Index, so filtering on knownness would silently
 * discard exactly the legitimate Bonus Words this tool exists to find. Knownness
 * sorts the list; it never shortens it.
 *
 * That split is most of what #186 delivers, and the reason is a quirk of the
 * engine: the Rhyme Index rejects a word with **no reading** as
 * `not-a-known-word`, because without a pronunciation it never got a rhyme test
 * at all. So the 239 words the measured `idiotic` day refused are two unrelated
 * piles — words we have never heard of, and words we know perfectly well and
 * cannot pronounce. 197 of them turned out to have wordhood, and ranked by
 * knownness the top of that pile reads `macrobiotic`, `biotic`, `necrotic`,
 * `orthotic`, `thrombotic`, `fibrotic`. That is the set a player would want.
 *
 * ## Where the facts come from
 *
 * Not from here. Wordhood, name status, readings, composition and knownness are
 * Node-only, and the browser cannot open any of the files that hold them — so
 * they arrive as an {@link EvidenceReply} from `/api/editor/evidence` and this
 * module stays pure: text and facts in, buckets out, no I/O and no network.
 * `web/src/editor/evidence.ts` argues why the wire carries evidence rather than
 * the buckets themselves.
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
import type { DemotionReason } from "../../../src/demotions.ts";
import type { RhymeKey } from "../../../src/phonology.ts";
import { respell } from "../../../src/respelling.ts";
import type { ComposedReading } from "../../../src/supplementEvidence.ts";
import type { DayReadout } from "../../../scripts/editorDay.ts";
import { isWord } from "./add.ts";
import type { AddOutcome } from "./addOutcome.ts";
import type { EvidenceReply, WordFacts } from "./evidence.ts";

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

/**
 * A word the day is missing a reading for: the main pile, and the one bucket
 * anything is ever added from.
 */
export interface WordWithoutReading {
  word: string;
  /**
   * Its prevalence row, or null when it has none. **Ordering only** — see the
   * module comment. A null sorts last rather than out.
   */
  knownness: number | null;
  /**
   * A reading composed from a compound split that lands on the day's Rhyme Key,
   * or null when no split reaches it.
   *
   * Non-null is what "resolvable on the spot" means: the reading exists, it has
   * already been through `verifyReading`, and nothing is left to judge. It is
   * aimed at **the day's Rhyme Key alone and never a set** — ADR-0014's measured
   * boundary, 0.12% wrong against one key against 62.0% against the 260
   * scheduled ones — and the target is fixed by the request that fetched this
   * evidence rather than chosen here.
   */
  composed: ComposedReading | null;
}

/**
 * A word with wordhood that the pinned sources already read, on some key other
 * than the day's — so the third party and our own pronunciation disagree.
 *
 * Kept out of the main pile because that pile is *words with no reading*, and an
 * add for a word that already reads is a **pronunciation correction** rather
 * than an add — a bigger claim, with its own door (`EDITOR_CORRECTION_PATH`) and
 * its own deliberation. Kept out of the demotions for the plainer reason that
 * it is a word. Shown read-only, respelled, so the disagreement can be read
 * rather than decoded: two of the measured `idiotic` day's 274 landed here.
 */
export interface ReadsElsewhereWord {
  word: string;
  /** Our own readings, respelled, alongside the key each lands on. */
  readings: { respelling: string; key: RhymeKey | null }[];
}

/**
 * A pasted word that is not a word of the game, and the rejection a player would
 * receive for it.
 *
 * ## Why a name is here even when the word list holds it
 *
 * Wordhood admits, but a **name is never valid however well it rhymes** — the
 * space of names is unbounded and has no defensible edge — and the two facts
 * come apart, because `data/words.txt` and `data/names.txt` overlap. `kate` is
 * in both. The evidence context is assembled from those files and applies no
 * demotions, so its `isWord` is the *unpatched* word list rather than the set
 * the Rhyme Index ends up serving; a name nobody has demoted yet reads as having
 * wordhood here and is being served as an ordinary Answer today.
 *
 * That is exactly the correction a demotion exists to make, so a name is offered
 * as one. The cost is a word like `bill` or `mark`, which is genuinely both, and
 * that cost is a per-word judgement in a read-only pile — the editor looks and
 * leaves it alone. The alternative loses the case the pile is for.
 */
export interface DemotableWord {
  word: string;
  /**
   * `proper-noun` when the word is in `data/names.txt`, `not-a-known-word`
   * otherwise.
   *
   * The reason travels with the word because it is **what the player is told**,
   * not a category: a demotion recorded without it would tell a player that an
   * abbreviation is somebody's name, or refuse a name without saying it is one.
   * `Kate` obviously rhymes with `ate`, and a silent refusal reads as a bug.
   */
  reason: DemotionReason;
}

/** The residue, split on wordhood. Null until the evidence for it has arrived. */
export interface PastedBuckets {
  /** Has wordhood, no reading. The main pile, ordered by knownness descending. */
  withoutReading: WordWithoutReading[];
  /** Has wordhood and reads, but not on the day's key. Read-only. */
  readsElsewhere: ReadsElsewhereWord[];
  /** Names and junk: not words of the game, offered as demotions. */
  demotable: DemotableWord[];
}

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
   *
   * It stays on the shape once the buckets exist, because it is what the
   * evidence was asked *about*: the caller matches a reply against it to know
   * whether the facts on screen are still the facts about what is on screen.
   */
  residue: string[];
  /**
   * The residue split on wordhood, or **null when no evidence for it has
   * arrived** — the state before the lookup, and after a day change has made an
   * earlier lookup's answers about a different Rhyme Key.
   *
   * Null rather than three empty arrays. "Nothing has been looked up" and "the
   * lookup found nothing to act on" are opposite facts about a day, and a screen
   * that rendered them the same way would tell an editor a day was in good shape
   * when nobody had asked.
   */
  buckets: PastedBuckets | null;
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
export function joinPastedList(
  text: string,
  readout: DayReadout | null,
  evidence: EvidenceReply | null = null,
): PastedList {
  if (readout === null || readout.outcome !== "day") {
    return { pasted: 0, covered: 0, residue: [], buckets: null };
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

  return {
    pasted: counted,
    covered: counted - residue.length,
    residue,
    buckets: bucketsOf(residue, readout.rhymeKey, evidence),
  };
}

/**
 * Split the residue on wordhood, given the facts about it.
 *
 * ## When the evidence is refused whole
 *
 * Two ways, and both answer null — which puts the screen back to "not looked up
 * yet", the thing that is actually true.
 *
 * - **It was gathered against another Rhyme Key.** A reply carries the key it
 *   was held against precisely so this check can exist: composition is aimed at
 *   one target (ADR-0014), so facts fetched for a day the editor has since
 *   navigated away from would mark the wrong words resolvable and offer a
 *   reading verified against a family nobody is looking at.
 * - **It does not answer about the whole residue.** The editor typed into the
 *   box after asking, or an add rebuilt the index and the day came back longer.
 *   A *partial* split is worse than none, because the words it silently left out
 *   are precisely the ones nobody would then think to look at — and a bucket
 *   short of a word reads as a word the tool considered and rejected.
 *
 * Refusing on the second is why the caller needs no staleness rule of its own:
 * the hook holds the last reply and hands it over unconditionally, and this is
 * what decides whether it is still about what is on screen.
 */
function bucketsOf(
  residue: readonly string[],
  rhymeKey: RhymeKey,
  evidence: EvidenceReply | null,
): PastedBuckets | null {
  if (evidence === null || evidence.rhymeKey !== rhymeKey) return null;

  const facts = new Map<string, WordFacts>();
  for (const word of evidence.words) facts.set(word.word, word);
  if (!residue.every((word) => facts.has(word))) return null;

  const withoutReading: WordWithoutReading[] = [];
  const readsElsewhere: ReadsElsewhereWord[] = [];
  const demotable: DemotableWord[] = [];

  for (const word of residue) {
    // Non-null by the check above, which refused the whole reply rather than let
    // a residue word fall out of the buckets unmentioned.
    const known = facts.get(word) as WordFacts;

    if (!known.isWord || known.isName) {
      demotable.push({ word, reason: known.isName ? "proper-noun" : "not-a-known-word" });
      continue;
    }

    if (known.direct.length > 0) {
      readsElsewhere.push({
        word,
        readings: known.direct.map((reading) => ({
          respelling: respell(reading.phonemes),
          key: reading.key,
        })),
      });
      continue;
    }

    // A composed reading is kept only when it lands on **this** key. Nothing
    // upstream should ever offer one that does not — `composeReading` runs every
    // candidate through `verifyReading`, which is exact equality against the
    // target — but the rule that a word is resolvable *only* on the day's Rhyme
    // Key is this feature's, ADR-0014 is what it costs to get wrong, and the
    // module where everything this feature knows lives is the one place it can
    // be read off rather than trusted to a caller.
    const composed = known.composed?.key === rhymeKey ? known.composed : null;
    withoutReading.push({ word, knownness: known.knownness, composed });
  }

  return { withoutReading: byKnownness(withoutReading), readsElsewhere, demotable };
}

/**
 * The main pile, best known first.
 *
 * A word with no prevalence row sorts **last rather than out**, which is the
 * rule this whole bucket is shaped around: it is already a Bonus Word as far as
 * the Rhyme Index is concerned, and dropping it would hide the finds a player
 * digs for. `sort` is stable in every runtime this ships to, so words that tie —
 * and every unmeasured word ties with every other — stay in the order the paste
 * gave them, which is the only order anything else here is in.
 *
 * "Last" is a **branch and not a sentinel**, because there is no number that
 * would work. `data/prevalence.csv`'s measured values are not a 0–1 scale: they
 * run negative, and 1,531 rows sit below −1 — so a sentinel of −1 would file
 * `orthopnoea` above a word nobody has ever measured, which is the one thing
 * this ordering promises not to do. Any other constant is the same mistake with
 * a different threshold.
 */
function byKnownness(words: readonly WordWithoutReading[]): WordWithoutReading[] {
  return [...words].sort((a, b) => {
    if (a.knownness === null) return b.knownness === null ? 0 : 1;
    if (b.knownness === null) return -1;
    return b.knownness - a.knownness;
  });
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

/**
 * The words in the main pile one gesture may carry, and the readings a previous
 * gesture already tried and could not use.
 *
 * ## Why the whole pile goes in one request
 *
 * Because the cost that matters is not the click count. One Submit appends to
 * `data/supplement.dict`, rebuilds the Rhyme Index and re-reads the day, so
 * chunking the measured day's 197 words into fifties would mean four rebuilds
 * and four re-reads to do one night's work. #190 is explicit that no batching
 * loop is introduced, and #186's story 19 is that the editor controls the volume
 * by what they select rather than by fighting a cap in the tool. So the bound
 * that remains is a transport bound at the route (`MAX_SUBMITTED_WORDS`), not a
 * workload one here.
 *
 * A word that composes and a word that does not both travel in that one request,
 * and the endpoint already tells them apart: `resolveAddOutcome` writes a
 * composed reading with no round trip and asks an agent for the rest. Splitting
 * them into two gestures here would be this module deciding a thing the add
 * route decides better, and would leave the bulk of the measured day — where
 * composition "will resolve close to none" of it — with no gesture at all.
 *
 * ## What is held back, and why it is only this
 *
 * "Accept-all is offered only where nothing is left to judge." The one thing in
 * this pile that leaves something to judge is a reading that was **sourced and
 * refused**: the agent proposed a pronunciation, `verifyReading` found it did
 * not land on the day's Rhyme Key, and the word came back `deferred` with what
 * it said. Sweeping that word into the next accept-all would ask the same
 * question again and get the same answer, silently — so the editor sees the
 * proposal instead, and learns the nomination was wrong rather than watching a
 * word do nothing twice.
 *
 * A word nobody has asked about yet leaves nothing to judge in the same sense:
 * there is no proposal to read and no verdict to weigh. It goes in the batch.
 */
export function pileToAccept(
  pile: readonly WordWithoutReading[],
  refused: ReadonlyMap<string, string>,
): string[] {
  return pile.filter((entry) => !refused.has(entry.word)).map((entry) => entry.word);
}

/**
 * The readings an add sourced for this key and could not use: each word against
 * what was proposed for it, respelled.
 *
 * Respelled here rather than at the render, because a respelling is what makes
 * the refusal readable — ARPAbet on a row the editor is being asked to judge is
 * a row they will skip — and because a pure function over a literal is where
 * that can be tested.
 *
 * ## Why the key is checked
 *
 * An `AddOutcome` names the Rhyme Key it was judged against, and an outcome
 * aimed elsewhere is not about this pile: a batch raised from the Candidate
 * Queue is aimed at the key an Appeal was recorded against, which is routinely
 * not the day's. Reading one of those as a refusal here would hold a word back
 * from the accept-all over a verdict reached about a different family. Same rule
 * as the join's own refusal of evidence gathered against another key, and it is
 * here for the same reason: it is a fact about what the evidence *is*.
 *
 * `agent-unavailable` is deliberately not in this map. Nothing was proposed and
 * nothing was judged — the agent did not answer — so there is nothing for the
 * editor to read and the word is simply asked about again on the next accept.
 */
export function refusedReadings(
  outcome: AddOutcome | null,
  rhymeKey: RhymeKey,
): Map<string, string> {
  const refused = new Map<string, string>();
  if (outcome === null || outcome.target !== rhymeKey) return refused;

  for (const word of outcome.words) {
    if (word.outcome !== "deferred") continue;
    if (word.reason !== "agent-reading-failed-verification") continue;
    if (word.proposed === null) continue;
    refused.set(word.word, respell(word.proposed));
  }
  return refused;
}
