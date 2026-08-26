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
 * module stays pure: text and facts in, piles out, no I/O and no network.
 * `web/src/editor/evidence.ts` argues why the wire carries evidence rather than
 * the piles themselves.
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
import type { DayReadout, DayWord } from "../../../scripts/editorDay.ts";
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
 * Nothing demoted, as one value — the default when a caller has no demotion list
 * to hand, and one identity rather than a fresh empty set per join.
 */
const NOTHING_DEMOTED: ReadonlySet<string> = new Set<string>();

/**
 * A word the day is missing a reading for: the main pile, and the only one
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
export type ReadsElsewhereWord = RespelledWord;

/**
 * A word in the day's **Answers** that the pasted list leaves out — the one
 * pile that runs the other way, and the only one built from our own words
 * rather than from theirs.
 *
 * Small: three on the measured `idiotic` day. Worth showing because a third
 * party omitting a word we serve is *sometimes* a signal that our reading is
 * wrong — and only sometimes, which is why the pile is **read-only and framed
 * neutrally**. It carries no verdict and no implied one. Acting on it is out of
 * scope for #186: sourcing an honest reading for a word that already reads is a
 * pronunciation correction rather than an add, and has no existing door. The
 * join computes the pile either way, so that route is purely additive once
 * there is evidence of how often the pile holds a real defect.
 *
 * The respelling is computed here rather than read off the readout, because
 * `DayWord` deliberately carries neither a pronunciation nor a respelling — the
 * day readout omits them so a two-hundred-word payload stays cheap enough to
 * re-read on every Submit. So the readings come off the same evidence seam the
 * residue is split on, and the browser respells them itself, exactly as
 * `disagreement.ts` already does.
 *
 * ## Why not a `...Word`, like its three neighbours
 *
 * Because it would be claiming something untrue. `WordWithoutReading`,
 * `ReadsElsewhereWord` and `DemotableWord` each name a property the word itself
 * carries, in the way `CONTEXT.md` says a **Tier** is carried — every rhyming
 * word with wordhood holds one whether or not anybody submits it. Nothing here
 * is like that. Paste one list for `idiotic` and `chaotic` is an omission; paste
 * a list that happens to include it and, same **Puzzle** and same **Rhyme Key**,
 * it is not. Membership belongs to a *(word, paste)* pair and lasts the sitting.
 *
 * Naming it for the **Answer** also puts the exclusion in the type where it can
 * be seen: `zymotic`, a **Bonus Word** the list leaves out, is deliberately not
 * here, and a `...Word` suffix would hide that. The on-screen heading stays
 * deictic — "On our list, not on theirs" is the right thing to say to an editor
 * reading the panel — so #186's own phrase for the pile survives where it was
 * aimed, at the person, and the code keeps the name that is true.
 */
export type OmittedAnswer = RespelledWord;

/** A word and our own readings of it, respelled, alongside the key each lands on. */
export interface RespelledWord {
  word: string;
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
 * that cost is a per-word judgement — the editor looks at the row and leaves it
 * alone. The alternative loses the case the pile is for.
 *
 * ## Why some of these are dismissed without a write
 *
 * Because a demotion is a correction, and a correction to nothing is a no-op.
 * The pile holds two populations: names the word list still holds, which are
 * served as ordinary Answers and which a demotion genuinely changes; and words
 * with no wordhood at all, which the engine already rejects. Only the first is
 * written. {@link DemotableWord.writes} is the distinction, and it is what keeps
 * `data/demotions.txt` a record of real corrections rather than a log of every
 * word a third party ever listed.
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
   *
   * Precisely, it is the second column a demotion *would* record, so it is what
   * the player is told on a row that {@link DemotableWord.writes}. On a row that
   * does not it is a label on what the word is and nothing more: the gate tests
   * wordhood before name-hood, so a name the word list never held is already
   * refused as `not-a-known-word` and no demotion changes that.
   *
   * It is what the row is labelled with and what a write is *offered* under —
   * never what a write is made under unasked. The editor picks between the two
   * (#191), because the pile's own test is name-hood against `data/names.txt`
   * and that file is a list of first names rather than a ruling: an abbreviation
   * somebody's parents also chose lands here reading `proper-noun`, and calling
   * it a name would be the small lie the second column exists to prevent.
   */
  reason: DemotionReason;
  /**
   * Whether demoting this word would change what the engine does.
   *
   * True when `data/words.txt` still holds it — the name-with-wordhood case,
   * which is being served as an ordinary Answer today and is exactly the
   * correction the demotion list exists to make. False when the word has no
   * wordhood: the engine already rejects it, so a demotion would be **stale on
   * arrival**, and writing one anyway would fill a hand-curated committed file
   * with no-ops. Such a word still leaves the screen; nothing is written for it.
   */
  writes: boolean;
}

/** The residue, split on wordhood. Null until the evidence for it has arrived. */
export interface PastedPiles {
  /** Day Answers the paste omits. Read-only, shown first, and usually empty. */
  omittedAnswers: OmittedAnswer[];
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
   * It stays on the shape once the piles exist, because it is what the
   * evidence was asked *about*: the caller matches a reply against it to know
   * whether the facts on screen are still the facts about what is on screen.
   */
  residue: string[];
  /**
   * Exactly the words one lookup should ask about: the residue, then the day's
   * Answers the paste omits.
   *
   * Two populations with nothing in common but the seam they come down. The
   * residue is asked about because the piles are a split of it; the omitted
   * Answers are asked about because {@link OmittedAnswer} shows our own
   * reading respelled and the day readout carries no pronunciation to respell.
   *
   * Assembled here rather than in the caller so that the rule stays in the
   * module everything this feature knows lives in — a hook that concatenated the
   * two lists itself would be the second place to change when a pile needs a
   * third. Disjoint by construction: a residue word is one the day does not
   * cover, and an omitted Answer is one the day covers.
   *
   * Empty when the paste held no words at all. With no third-party list there is
   * no third party to disagree with, and every Answer would otherwise read as
   * omitted by a list that does not exist.
   */
  lookup: string[];
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
  piles: PastedPiles | null;
}

/**
 * Join a pasted rhyme list against the day on screen.
 *
 * The join runs both ways. Pasted words the day covers collapse to a count and
 * the rest become the residue; day **Answers** the paste omits become the one
 * pile that reads back the other direction ({@link OmittedAnswer}).
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
  demoted: ReadonlySet<string> = NOTHING_DEMOTED,
): PastedList {
  if (readout === null || readout.outcome !== "day") {
    return { pasted: 0, covered: 0, residue: [], lookup: [], piles: null };
  }

  // Both sides of the comparison go through `normaliseWord`, so the join can
  // never turn on a casing difference between a third party's spelling and the
  // index's. The index's are already lower-cased; this is what keeps the match
  // from depending on that staying true.
  const covered = new Set<string>();
  for (const entry of readout.answers) covered.add(normaliseWord(entry.word));
  for (const entry of readout.bonusWords) covered.add(normaliseWord(entry.word));

  let counted = 0;
  // The third party's own list, as a set — named apart from the `pasted` count
  // below because one is what they listed and the other is how many.
  const listed = new Set<string>();
  const residue: string[] = [];
  for (const word of pastedWords(text)) {
    counted += 1;
    listed.add(word);
    if (!covered.has(word)) residue.push(word);
  }

  const omitted = counted === 0 ? [] : [...omissionsOf(readout.answers, listed, demoted)];

  return {
    pasted: counted,
    covered: counted - residue.length,
    residue,
    lookup: [...residue, ...omitted],
    piles: pilesOf(residue, omitted, readout.rhymeKey, evidence, demoted),
  };
}

/**
 * The day's Answers the paste leaves out, in the readout's own order.
 *
 * **Answers and never Bonus Words.** The pile asks whether a word we serve as
 * part of the Puzzle is one a third party would not, and a Bonus Word is already
 * the game saying almost nobody knows this — a rhyme list omitting one is the
 * expected case rather than a signal.
 *
 * ## Why the demotions are read here and not by `covered`
 *
 * A word the game no longer holds is left out for the reason it is left out of
 * every other pile: it is on its way out of the Puzzle at the next rebuild,
 * and asking the editor to weigh our reading of a word they have just refused is
 * asking about a word that will not be there.
 *
 * That reads as inconsistent with the join above, which builds `covered` from
 * the **built** day and applies no demotions to it — this filter is the one
 * place in the module that reads something **Corrected Day**–shaped. It is not:
 * the two choices are the same rule seen from either side, which is **never
 * re-offer a word the editor has just refused**. Counting a demoted word as
 * covered is what stops it coming back as residue for a second demotion;
 * dropping it here is what stops it coming back as an omission, asking the
 * editor to re-weigh our reading of a word they have already thrown out. Making
 * either half agree with the other's *shape* would break the rule they share.
 *
 * Deduplicated because the list travels to an endpoint that refuses a request
 * naming the same word twice, and two spellings in the Answers can normalise
 * alike even though the index's own are distinct.
 */
function* omissionsOf(
  answers: readonly DayWord[],
  listed: ReadonlySet<string>,
  demoted: ReadonlySet<string>,
): Generator<string> {
  const seen = new Set<string>();
  for (const entry of answers) {
    const word = normaliseWord(entry.word);
    if (listed.has(word) || demoted.has(word) || seen.has(word)) continue;
    seen.add(word);
    yield word;
  }
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
 *   are precisely the ones nobody would then think to look at — and a pile
 *   short of a word reads as a word the tool considered and rejected.
 *
 * Refusing on the second is why the caller needs no staleness rule of its own:
 * the hook holds the last reply and hands it over unconditionally, and this is
 * what decides whether it is still about what is on screen.
 */
function pilesOf(
  residue: readonly string[],
  omitted: readonly string[],
  rhymeKey: RhymeKey,
  evidence: EvidenceReply | null,
  demoted: ReadonlySet<string>,
): PastedPiles | null {
  if (evidence === null || evidence.rhymeKey !== rhymeKey) return null;

  const facts = new Map<string, WordFacts>();
  for (const word of evidence.words) facts.set(word.word, word);
  if (!residue.every((word) => facts.has(word))) return null;

  const omittedAnswers: OmittedAnswer[] = [];
  const withoutReading: WordWithoutReading[] = [];
  const readsElsewhere: ReadsElsewhereWord[] = [];
  const demotable: DemotableWord[] = [];

  for (const word of residue) {
    // A word the game no longer holds is offered in **no pile at all**, and
    // that one line is what makes a dismissal stick (#191). It covers both ways
    // a word arrives here: an entry in `data/demotions.txt`, which is durable
    // and withdraws wordhood on every day the word ever appeared on; and a stale
    // dismissal this sitting made without a write, held in memory because there
    // is nothing true to write. Either way nothing is left to do about the word,
    // and a row offering the demotion again would be offering a no-op.
    //
    // Deliberately inside this loop rather than over the residue above it. The
    // residue is what the evidence reply was asked about, and shortening it
    // would fail the reply's own "answers about the whole residue" check the
    // moment anything was dismissed — every pile would vanish along with the
    // row the editor had just acted on.
    if (demoted.has(word)) continue;

    // Non-null by the check above, which refused the whole reply rather than let
    // a residue word fall out of the piles unmentioned.
    const known = facts.get(word) as WordFacts;

    if (!known.isWord || known.isName) {
      demotable.push({
        word,
        reason: known.isName ? "proper-noun" : "not-a-known-word",
        // Wordhood, and not name-hood, is what makes the write worth making: a
        // name the word list holds is served today, and a word it does not hold
        // is already refused.
        writes: known.isWord,
      });
      continue;
    }

    if (known.direct.length > 0) {
      readsElsewhere.push({ word, readings: respellings(known) });
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

  // The omitted Answers are asked about in the same request as the residue, so in
  // the running tool this loop finds every one of them. A word it does not is
  // skipped rather than refused, and that asymmetry with the residue above is
  // deliberate: the residue is what everything actionable comes out of, and a
  // pile silently a word short is a word nobody would then think to look at,
  // whereas this pile is read-only and carries no verdict. Refusing the whole
  // split — the accepts, the demotions — because a read-only comparison came up
  // short would trade the pile the editor acts on for the one they only read.
  for (const word of omitted) {
    const known = facts.get(word);
    if (known === undefined) continue;
    omittedAnswers.push({ word, readings: respellings(known) });
  }

  return {
    omittedAnswers,
    withoutReading: byKnownness(withoutReading),
    readsElsewhere,
    demotable,
  };
}

/**
 * Our own readings of a word, respelled, alongside the key each lands on.
 *
 * Every one of them rather than the first: a spelling may have more than one
 * pronunciation, and which of them lands on the day's key is exactly the thing
 * the editor is reading the row to work out.
 */
function respellings(known: WordFacts): RespelledWord["readings"] {
  return known.direct.map((reading) => ({
    respelling: respell(reading.phonemes),
    key: reading.key,
  }));
}

/**
 * The main pile, best known first.
 *
 * A word with no prevalence row sorts **last rather than out**, which is the
 * rule this whole pile is shaped around: it is already a Bonus Word as far as
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
 * page the editor copied rather than words they nominated, and a pile of them
 * would be a pile nobody ever acts on. A duplicate is absorbed for a plainer
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
 * What one accept-all carries: the words, and how many of them need nobody
 * asked.
 *
 * The count is returned beside the batch rather than left to the caller because
 * it is a **partition of the batch and not a fact about the pile**. It is
 * printed under the button — "N of them compose from a compound split and are
 * written straight away; the rest are asked of an agent" — which is a claim
 * about the words in the request, so a word held back cannot be counted among
 * them. Computed separately it would restate the hold-back rule below, in a
 * second place, where the two are free to drift.
 */
export interface AcceptBatch {
  /** The words the request carries, in the pile's own order. */
  words: string[];
  /** How many of those a compound split reaches, so no agent is asked for them. */
  composes: number;
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
): AcceptBatch {
  const carried = pile.filter((entry) => !refused.has(entry.word));
  return {
    words: carried.map((entry) => entry.word),
    composes: carried.filter((entry) => entry.composed !== null).length,
  };
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

/**
 * Every refusal still standing for this Rhyme Key: the ones already held, plus
 * what this outcome refused, less what it has since written.
 *
 * ## Why refusals accumulate rather than being read off the last outcome
 *
 * Because a reading that failed verification is "always handled per-word, never
 * swept into the bulk accept" (#190), and read off the last outcome alone that
 * "always" means *for one round*. Only one outcome is on the hook at a time, and
 * a second accept — or any typed Submit on the day tab — replaces it. The word
 * would lose its mark, walk back into the next bulk batch, ask the same question
 * and get the same answer with nobody looking, which is the exact failure the
 * hold-back exists to prevent.
 *
 * ## Why `written` clears the mark
 *
 * Because the mark is what makes the per-word "Ask again" worth offering. The
 * agent is not deterministic, so a second ask can land — and a word that now has
 * a reading has nothing left for the editor to judge. A map that only ever grew
 * would flag it for the rest of the sitting against a verdict already overtaken.
 *
 * An outcome aimed at another Rhyme Key changes nothing, on `refusedReadings`'
 * own rule and for its reason: it is not about this pile. That covers the
 * clearing too — a word written against another key did not get *this* key's
 * reading, so the refusal held here still stands.
 */
export function mergeRefusals(
  held: ReadonlyMap<string, string>,
  outcome: AddOutcome | null,
  rhymeKey: RhymeKey,
): Map<string, string> {
  const merged = new Map(held);
  if (outcome === null || outcome.target !== rhymeKey) return merged;

  for (const word of outcome.words) {
    if (word.outcome === "written") merged.delete(word.word);
  }
  // After the clearing rather than before it, so a word this outcome both wrote
  // and refused — which one batch cannot produce, but a wire shape does not
  // promise that — reads as refused rather than as resolved.
  for (const [word, proposed] of refusedReadings(outcome, rhymeKey)) {
    merged.set(word, proposed);
  }
  return merged;
}
