/**
 * The Rhyme Index: a single seam over pronunciation, wordhood and knownness
 * data, exposing two operations — `adjudicate` and `buildPuzzle`. Everything the
 * design settled lives behind here (the stress rule, variant handling,
 * proper-noun exclusion, the Answer/Bonus split); nothing above it needs to know
 * what a phoneme is (ADR-0001..0005).
 *
 * It is data, not a service: a pure function over static inputs, with no notion
 * of players, sessions, scores, days, or ranks. "Already submitted" state is
 * passed in by the caller, never held here.
 */

import {
  bareSound,
  rhymeKeyOf,
  stressOf,
  withStress,
  type Pronunciation,
  type RhymeKey,
} from "./phonology.ts";
import { normaliseWord } from "./cmudict.ts";
import { Derivation, IndexDataSource } from "./derivation.ts";
import { respell } from "./respelling.ts";
import { schwaTwinOf } from "./schwaTwins.ts";
import { tierFor, type Tier, type Verdict } from "./verdict.ts";

/** A curated Seed Word: the word itself plus its single pinned Rhyme Key. */
export interface SeedWord {
  word: string;
  rhymeKey: RhymeKey;
}

/** One member of a built Puzzle. */
export interface PuzzleEntry {
  word: string;
  length: number;
  knownness: number | null;
  pronunciation: Pronunciation;
  respelling: string;
}

/**
 * One member of a Rhyme Key's family: a wordhood-valid word that rhymes on the
 * key, the reading that put it there, and the tier it holds. It is a
 * `PuzzleEntry` without the respelling — respelling is how a Puzzle *presents* a
 * member, and curation, which only counts, should not pay for it 133,000 times.
 */
export interface FamilyMember {
  word: string;
  length: number;
  knownness: number | null;
  /** The reading whose Rhyme Key put this word in the family. */
  pronunciation: Pronunciation;
  tier: Tier;
}

/**
 * Every wordhood-valid word that rhymes on one Rhyme Key, tiered — the shared
 * answer to the question `buildPuzzle` and curation were each answering for
 * themselves. Members are sorted by word, so anything built from a family is
 * deterministic.
 *
 * No Seed Word has been excluded yet: which member is the Seed is a decision
 * made *about* a family, not a property of it, and curation picks a
 * representative only after seeing the whole membership. `splitFamily` is where
 * exclusion happens, once, for both callers.
 */
export interface RhymeFamily {
  rhymeKey: RhymeKey;
  members: FamilyMember[];
  /**
   * Other Rhyme Keys folded into this one because they are its Schwa Twin —
   * differing only by the optional schwa before a word-final syllabic `L`,
   * `N` or `M` (`schwaTwins.ts`, issue #110). `members` already holds the
   * union; this is provenance, so a caller like curation can report which
   * keys merged rather than the merge happening invisibly. Empty when this
   * family absorbed nothing.
   */
  mergedKeys: RhymeKey[];
}

/**
 * Split a family into disjoint Answers and Bonus Words for a given Seed Word.
 * The Seed Word is excluded from its own Puzzle — the single definition of that
 * rule, which `buildPuzzle` and curation used to each state separately and keep
 * in agreement by a comment. Member order (by word) is preserved.
 */
export function splitFamily(
  family: RhymeFamily,
  seedWord: string,
): { answers: FamilyMember[]; bonusWords: FamilyMember[] } {
  const seed = normaliseWord(seedWord);
  const answers: FamilyMember[] = [];
  const bonusWords: FamilyMember[] = [];
  for (const member of family.members) {
    if (member.word === seed) continue;
    (member.tier === "answer" ? answers : bonusWords).push(member);
  }
  return { answers, bonusWords };
}

export interface Puzzle {
  seed: SeedWord;
  /**
   * Plain-English respelling of the Seed Word, read in its pinned Rhyme Key — the
   * "establish the pronunciation first" promise, so a client can show how the
   * Seed is meant to sound before play begins.
   */
  seedRespelling: string;
  answers: PuzzleEntry[];
  bonusWords: PuzzleEntry[];
}

export interface RhymeIndexData {
  /** Surface form -> its pronunciations (from CMUdict). */
  pronunciations: Map<string, Pronunciation[]>;
  /** Common English words, lower-cased. The wordhood gate; excludes names. */
  words: Set<string>;
  /** Lower-cased names, used only to label a rejection as a Proper Noun. */
  names: Set<string>;
  /** Lemma -> word-prevalence score (knownness). */
  prevalence: Map<string, number>;
}

export interface RhymeIndexConfig {
  /** Prevalence at or above which a rhyming word is an Answer, else a Bonus. */
  knownnessThreshold: number;
}

const VALID_SUBMISSION = /^[a-z]+$/;

const byMemberWord = (a: FamilyMember, b: FamilyMember) => a.word.localeCompare(b.word);

/**
 * True if `candidate` is exactly `earlier` with its final unstressed schwa
 * dropped and the sonorant that followed it left to carry the syllable alone —
 * the shape `src/normalise.ts`'s `syllabic-consonant` rule appends (`gruel`'s
 * `G R UW1 AH0 L` gains `G R UW1 L`). Recognised by shape, not tracked with a
 * second piece of data: the rule only ever *appends*, so a generated reading is
 * always a later entry in the word's own list, and it is always exactly this
 * transform (or `isStressPromotionVariantOf`, below) of an earlier one (#75).
 *
 * Deliberately looser than the rule it recognises: it does not re-check that
 * the sonorant is one the rule would have acted on, or the vowel-before-the-
 * schwa restrictions that decide whether the rule *fires*. Those restrictions
 * only ever narrow which readings get a variant generated in the first place;
 * skipping them here can only make this function say "generated" about a
 * reading that is, in fact, base — refusing a pin the data would have allowed,
 * never permitting one it would have refused. Pinning fails safe.
 */
function isSyllabicConsonantVariantOf(candidate: Pronunciation, earlier: Pronunciation): boolean {
  if (candidate.length !== earlier.length - 1) return false;
  const schwa = earlier.at(-2);
  const sonorant = earlier.at(-1);
  if (schwa === undefined || sonorant === undefined) return false;
  if (bareSound(schwa) !== "AH" || stressOf(schwa) !== 0) return false;
  if (candidate.at(-1) !== sonorant) return false;
  return candidate.slice(0, -1).every((phoneme, i) => phoneme === earlier[i]);
}

/**
 * True if `candidate` is exactly `earlier` with one unstressed vowel promoted
 * to secondary stress and nothing else changed — the shape `src/normalise.ts`'s
 * `stress-promotion` rule appends (`module`'s `M AA1 JH UW0 L` gains
 * `M AA1 JH UW2 L`). See `isSyllabicConsonantVariantOf` for why shape, not a
 * schema field, is what pinning reads.
 */
function isStressPromotionVariantOf(candidate: Pronunciation, earlier: Pronunciation): boolean {
  if (candidate.length !== earlier.length) return false;
  let diffIndex = -1;
  for (let i = 0; i < earlier.length; i++) {
    if (candidate[i] === earlier[i]) continue;
    if (diffIndex !== -1) return false; // more than one phoneme differs
    diffIndex = i;
  }
  if (diffIndex === -1) return false; // identical readings, not a variant
  const original = earlier[diffIndex]!;
  return stressOf(original) === 0 && candidate[diffIndex] === withStress(original, 2);
}

/**
 * True if `candidate` is a generated variant of `earlier` — a reading
 * normalisation appended alongside it, rather than one the pinned data ever
 * transcribed. The two shapes above are the whole of the frozen rule set that
 * appends (ADR-0011); the rule that replaces (the cot-caught merger) never
 * grows a word's reading count, so it needs no shape here.
 */
function isGeneratedVariantOf(candidate: Pronunciation, earlier: Pronunciation): boolean {
  return (
    isSyllabicConsonantVariantOf(candidate, earlier) ||
    isStressPromotionVariantOf(candidate, earlier)
  );
}

/**
 * Fold every Schwa Twin pair in a freshly-built family map into one entry
 * under the schwa-ful key, with the union of both keys' members (issue #110).
 * `families()`'s own pass files a word under each of its *own* readings'
 * literal keys, so a pair like `EH K SH AH N` / `EH K SH N` still lands as two
 * separate map entries there — this is the second half that makes it agree
 * with `#matchingPronunciation`'s twin fallback, which a single word's own
 * per-reading traversal cannot express (a word with no reading at all on the
 * schwa-ful key, like `subsection`, never asks to be filed under it there).
 *
 * The schwa-ful key is always the survivor: it is the one the pinned data
 * actually transcribes, the schwa-less key exists only because normalisation
 * appended it (ADR-0010), and curation picks Seeds from survivors. Told apart
 * by token count — a Schwa Twin pair differs by exactly the one `AH` token,
 * so whichever of the two keys is longer is the schwa-ful one.
 */
function mergeSchwaTwins(raw: Map<RhymeKey, RhymeFamily>): Map<RhymeKey, RhymeFamily> {
  const schwalessOf = new Map<RhymeKey, RhymeKey>(); // schwa-ful key -> schwa-less key
  const absorbed = new Set<RhymeKey>(); // every schwa-less key folded elsewhere
  for (const key of raw.keys()) {
    const twin = schwaTwinOf(key);
    if (twin === null || !raw.has(twin)) continue;
    if (key.split(" ").length > twin.split(" ").length) {
      schwalessOf.set(key, twin);
      absorbed.add(twin);
    }
  }

  const merged = new Map<RhymeKey, RhymeFamily>();
  for (const [key, family] of raw) {
    if (absorbed.has(key)) continue; // folded into its schwa-ful sibling below
    const schwaless = schwalessOf.get(key);
    if (schwaless === undefined) {
      merged.set(key, family);
      continue;
    }
    const twinFamily = raw.get(schwaless)!;
    const byWord = new Map(family.members.map((m) => [m.word, m]));
    for (const member of twinFamily.members) {
      if (!byWord.has(member.word)) byWord.set(member.word, member);
    }
    merged.set(key, {
      rhymeKey: key,
      members: [...byWord.values()].sort(byMemberWord),
      mergedKeys: [schwaless],
    });
  }
  return merged;
}

export class RhymeIndex {
  readonly #data: RhymeIndexData;
  readonly #config: RhymeIndexConfig;

  /**
   * Derivation questions — is this word derived, what lemmas could it reduce to
   * — answered against this index's own data (ADR-0008). Reached as a property
   * so a caller never assembles the lookups itself, and the index's own tier
   * judgement uses this same instance rather than a second closure over itself.
   */
  readonly derivation: Derivation;

  constructor(data: RhymeIndexData, config: RhymeIndexConfig) {
    this.#data = data;
    this.#config = config;
    this.derivation = new Derivation(new IndexDataSource(data));
  }

  /** All Rhyme Keys of a surface form (one per pronunciation). */
  rhymeKeysOf(word: string): RhymeKey[] {
    const prons = this.#data.pronunciations.get(normaliseWord(word)) ?? [];
    const keys: RhymeKey[] = [];
    for (const pron of prons) {
      const key = rhymeKeyOf(pron);
      if (key !== null && !keys.includes(key)) keys.push(key);
    }
    return keys;
  }

  /** True if the word has more than one Rhyme Key (spelling reads two ways). */
  isAmbiguous(word: string): boolean {
    return this.rhymeKeysOf(word).length > 1;
  }

  /**
   * True if the surface form is in the wordhood word list. Exposed so curation
   * can test a member's derivation (ADR-0008) against the very word set the
   * wordhood gate uses — a word is *derived* only relative to other real words.
   */
  hasWord(word: string): boolean {
    return this.#data.words.has(normaliseWord(word));
  }

  /**
   * Every wordhood-valid surface form with its pronunciations — the words that
   * can appear in a Puzzle (names and non-words excluded). The single traversal
   * both `buildPuzzle` and curation are built on.
   */
  *wordhoodEntries(): Generator<readonly [string, Pronunciation[]]> {
    for (const [word, prons] of this.#data.pronunciations) {
      if (this.#data.words.has(word)) yield [word, prons];
    }
  }

  /**
   * Pin a Seed Word to exactly one Rhyme Key. If the word has a single Rhyme
   * Key, it is chosen automatically; if it has several (a word like `bass`), the
   * caller must pass `rhymeKey` to disambiguate. An explicit key must be one of
   * the word's own Rhyme Keys, or a mistyped key would silently yield an
   * incoherent Puzzle.
   *
   * Either way, the key must be backed by a *base* reading — one the pinned
   * data actually transcribed, never one normalisation manufactured alongside
   * it (`#requireBaseKey`). ADR-0002 makes the Seed's spoken audio and
   * respelling load-bearing, so a Seed can never be pinned to a pronunciation
   * no dictionary source ever asserted (#75).
   */
  pinSeed(word: string, rhymeKey?: RhymeKey): SeedWord {
    const keys = this.rhymeKeysOf(word);
    if (rhymeKey !== undefined) {
      if (!keys.includes(rhymeKey)) {
        throw new Error(
          `Cannot pin seed "${word}" to ${rhymeKey}: not one of its Rhyme Keys (${keys.join(", ") || "none"}).`,
        );
      }
      this.#requireBaseKey(word, rhymeKey);
      return { word: normaliseWord(word), rhymeKey };
    }
    if (keys.length === 1) {
      this.#requireBaseKey(word, keys[0]!);
      return { word: normaliseWord(word), rhymeKey: keys[0]! };
    }
    if (keys.length === 0) {
      throw new Error(`Cannot pin seed "${word}": no pronunciation found.`);
    }
    throw new Error(
      `Cannot pin seed "${word}": ${keys.length} pronunciations (${keys.join(", ")}). Pass a rhymeKey.`,
    );
  }

  /**
   * Refuse a Rhyme Key no base reading of the word carries — one reachable only
   * through a reading normalisation generated. A word's first reading is always
   * a base reading (a generated variant is always appended after at least one
   * reading already exists), so this only ever bites a *later* reading that
   * turns out to be wholly a generated variant's doing — currently only
   * possible via an explicit `rhymeKey`, since an automatically-picked single
   * key already traces to the first reading. Guarded here too, defensively:
   * `src/normalise.ts` itself notes stress promotion carries no *structural*
   * guard against ever minting a word's first Rhyme Key, only an empirical one.
   */
  #requireBaseKey(word: string, rhymeKey: RhymeKey): void {
    const prons = this.#data.pronunciations.get(normaliseWord(word)) ?? [];
    const hasBaseReading = prons.some(
      (pron, i) =>
        rhymeKeyOf(pron) === rhymeKey &&
        !prons.slice(0, i).some((earlier) => isGeneratedVariantOf(pron, earlier)),
    );
    if (!hasBaseReading) {
      throw new Error(
        `Cannot pin seed "${word}" to ${rhymeKey}: every reading on that key is a generated ` +
          `variant, and a Seed must be spoken in a reading the dictionary actually transcribed.`,
      );
    }
  }

  /**
   * Adjudicate a Submission against a Seed Word. `alreadySubmitted` holds the
   * normalised words the player has already had accepted this Puzzle.
   */
  adjudicate(
    seed: SeedWord,
    submission: string,
    alreadySubmitted: ReadonlySet<string> = new Set(),
  ): Verdict {
    const word = normaliseWord(submission);

    if (!VALID_SUBMISSION.test(word)) {
      return { outcome: "rejected", reason: "malformed" };
    }
    if (word === normaliseWord(seed.word)) {
      return { outcome: "rejected", reason: "is-the-seed-word" };
    }
    if (alreadySubmitted.has(word)) {
      return { outcome: "rejected", reason: "already-submitted" };
    }

    // Wordhood and names are decided independently of rhyme: a name is never
    // valid however well it rhymes (CONTEXT.md), and a non-word is a typo.
    if (!this.#data.words.has(word)) {
      if (this.#data.names.has(word)) {
        return { outcome: "rejected", reason: "proper-noun" };
      }
      return { outcome: "rejected", reason: "not-a-known-word" };
    }

    // A word can pass the wordhood gate yet be absent from the pronunciation
    // data (e.g. `founds`, `nightgowns` — in the word list, missing from
    // CMUdict). Without a pronunciation there is nothing to rhyme-test, so
    // `does-not-rhyme` would be untruthful — the word never got a rhyme test.
    // Reject as `not-a-known-word`: without a reading, the engine cannot treat
    // it as a fully known word (reusing the closed reason set, ADR-0005).
    const prons = this.#data.pronunciations.get(word) ?? [];
    if (prons.length === 0) {
      return { outcome: "rejected", reason: "not-a-known-word" };
    }
    const match = this.#matchingPronunciation(seed.rhymeKey, prons);
    if (!match) {
      const used = prons[0];
      return {
        outcome: "rejected",
        reason: "does-not-rhyme",
        ...(used ? { pronunciation: used, respelling: respell(used) } : {}),
      };
    }

    const { tier, knownness } = this.#tier(word);
    return {
      outcome: tier,
      pronunciation: match,
      respelling: respell(match),
      length: word.length,
      knownness,
    };
  }

  /**
   * The family of one Rhyme Key: one scan of the word list, for one key. What
   * `buildPuzzle` needs, and nothing more — a caller that wants every key should
   * ask `families()` rather than call this in a loop, which is the O(keys ×
   * words) trap curation used to hand-inline its way around.
   *
   * Membership already includes a Schwa Twin's members: `#memberOf` matches a
   * word through `#matchingPronunciation`, which falls back to the twin key
   * (issue #110), so a word like `subsection` — no reading of its own ever
   * lands on `EH K SH AH N` — still turns up here for that key, through the
   * `EH K SH N` reading it does have. `mergedKeys` says so, on the same terms
   * `#matchingPronunciation` does: whenever `rhymeKey` has a twin at all, not
   * only when a member happened to need it this time, because the fallback is
   * always live for this key, and a caller reading `mergedKeys` should be told
   * the truth about the matching rule in force, not just today's result.
   */
  familyOf(rhymeKey: RhymeKey): RhymeFamily {
    const members: FamilyMember[] = [];
    for (const [word, prons] of this.wordhoodEntries()) {
      const member = this.#memberOf(word, prons, rhymeKey);
      if (member) members.push(member);
    }
    members.sort(byMemberWord);
    const twin = schwaTwinOf(rhymeKey);
    return { rhymeKey, members, mergedKeys: twin === null ? [] : [twin] };
  }

  /**
   * A family per Rhyme Key, in a *single* pass over the word list — the traversal
   * curation is built on. Building a Puzzle per key would re-scan every wordhood
   * word each time; this visits each word once and files it under every key it
   * rhymes on (a word with two readings joins two families).
   *
   * Unlike `familyOf`, this pass files each word under its *own* readings'
   * literal keys, so a Schwa Twin pair still comes out as two separate map
   * entries here — `mergeSchwaTwins` folds them together afterwards, unioning
   * membership under the schwa-ful key (issue #110). Both paths agree because
   * `#matchingPronunciation`'s twin fallback and this merge encode the same
   * equivalence from two directions: fixing one without the other would leave
   * curation and adjudication answering differently for the same Seed.
   */
  families(): Map<RhymeKey, RhymeFamily> {
    const families = new Map<RhymeKey, RhymeFamily>();
    for (const [word, prons] of this.wordhoodEntries()) {
      const seen = new Set<RhymeKey>();
      for (const pron of prons) {
        const key = rhymeKeyOf(pron);
        if (key === null || seen.has(key)) continue;
        seen.add(key);
        const member = this.#memberOf(word, prons, key);
        if (member === null) continue;
        const family = families.get(key);
        if (family) family.members.push(member);
        else families.set(key, { rhymeKey: key, members: [member], mergedKeys: [] });
      }
    }
    for (const family of families.values()) family.members.sort(byMemberWord);
    return mergeSchwaTwins(families);
  }

  /**
   * Build the complete Puzzle for a Seed Word: every wordhood-valid rhyming word,
   * split into disjoint Answers and Bonus Words, each carrying length and
   * knownness. Deterministic — members are sorted, so the same Seed Word always
   * yields an identical Puzzle.
   *
   * Membership, tier and Seed exclusion all come from the shared family; the
   * only thing added here is the respelling, which is how a Puzzle presents a
   * member rather than part of deciding who its members are.
   */
  buildPuzzle(seed: SeedWord): Puzzle {
    const { answers, bonusWords } = splitFamily(this.familyOf(seed.rhymeKey), seed.word);
    const toEntry = (member: FamilyMember): PuzzleEntry => ({
      word: member.word,
      length: member.length,
      knownness: member.knownness,
      pronunciation: member.pronunciation,
      respelling: respell(member.pronunciation),
    });

    // Respell the Seed Word in its own pinned reading, so the Puzzle can announce
    // how the Seed sounds before play (a homograph like `bass` is spoken in the
    // one reading its Rhyme Key fixes, never the other).
    const seedProns = this.#data.pronunciations.get(normaliseWord(seed.word)) ?? [];
    const seedMatch = this.#matchingPronunciation(seed.rhymeKey, seedProns);
    const seedRespelling = seedMatch ? respell(seedMatch) : "";

    return {
      seed,
      seedRespelling,
      answers: answers.map(toEntry),
      bonusWords: bonusWords.map(toEntry),
    };
  }

  /**
   * The tier and knownness of a wordhood-valid word — the same judgement
   * `buildPuzzle` and `adjudicate` apply. Public so curation can rank a
   * representative on knownness without going back through a family.
   */
  tierOf(word: string): { tier: Tier; knownness: number | null } {
    return this.#tier(normaliseWord(word));
  }

  /**
   * The one definition of family membership: does this word rhyme on the key,
   * and if so, what does it bring? Both traversals go through here, so
   * `buildPuzzle` and curation cannot drift on who belongs or how they tier.
   */
  #memberOf(
    word: string,
    prons: Pronunciation[],
    rhymeKey: RhymeKey,
  ): FamilyMember | null {
    const match = this.#matchingPronunciation(rhymeKey, prons);
    if (!match) return null;
    const { tier, knownness } = this.#tier(word);
    return { word, length: word.length, knownness, pronunciation: match, tier };
  }

  /**
   * A literal match always wins first — every reading the data ever asserted
   * or a rule generated is checked before anything else is consulted, so a
   * Submission that already rhymed keeps rhyming on exactly the reading it
   * always matched (never the Schwa Twin fallback below), no verdict this
   * index has ever returned changes.
   *
   * Only when no reading matches literally do we ask whether `seedKey` has a
   * Schwa Twin (issue #110) and try that instead — the same "append, never
   * replace" shape ADR-0010's own rule uses: this can only turn a past
   * rejection into an acceptance, never the reverse.
   */
  #matchingPronunciation(
    seedKey: RhymeKey,
    prons: Pronunciation[],
  ): Pronunciation | null {
    for (const pron of prons) {
      if (rhymeKeyOf(pron) === seedKey) return pron;
    }
    const twin = schwaTwinOf(seedKey);
    if (twin !== null) {
      for (const pron of prons) {
        if (rhymeKeyOf(pron) === twin) return pron;
      }
    }
    return null;
  }

  /**
   * Tier a rhyming, wordhood-valid word by knownness. Lemmatise before the
   * lookup (never before rhyme matching). A word absent from the prevalence data
   * defaults to Bonus, so a coverage gap never refuses a real word (ADR-0003).
   *
   * Lemmatised through the readings, not the spelling alone: `ups` tiers on `up`
   * because it sounds like `up` + S, and `has` keeps its own standing because it
   * does not sound like `ha` + Z. Through `this.derivation`, so the tier a word
   * gets here and the derivation verdict curation reads are one rule.
   */
  #tier(word: string): { tier: Tier; knownness: number | null } {
    for (const candidate of this.derivation.lemmaCandidates(word)) {
      const score = this.#data.prevalence.get(candidate);
      if (score !== undefined) {
        return {
          tier: tierFor(score, this.#config.knownnessThreshold),
          knownness: score,
        };
      }
    }
    return { tier: "bonus", knownness: null };
  }
}
