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

import { rhymeKeyOf, type Pronunciation, type RhymeKey } from "./phonology.ts";
import { normaliseWord } from "./cmudict.ts";
import { lemmaCandidates } from "./lemmatise.ts";
import { respell } from "./respelling.ts";
import type { Tier, Verdict } from "./verdict.ts";

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

export interface Puzzle {
  seed: SeedWord;
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

export class RhymeIndex {
  readonly #data: RhymeIndexData;
  readonly #config: RhymeIndexConfig;

  constructor(data: RhymeIndexData, config: RhymeIndexConfig) {
    this.#data = data;
    this.#config = config;
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
   */
  pinSeed(word: string, rhymeKey?: RhymeKey): SeedWord {
    const keys = this.rhymeKeysOf(word);
    if (rhymeKey !== undefined) {
      if (!keys.includes(rhymeKey)) {
        throw new Error(
          `Cannot pin seed "${word}" to ${rhymeKey}: not one of its Rhyme Keys (${keys.join(", ") || "none"}).`,
        );
      }
      return { word: normaliseWord(word), rhymeKey };
    }
    if (keys.length === 1) return { word: normaliseWord(word), rhymeKey: keys[0]! };
    if (keys.length === 0) {
      throw new Error(`Cannot pin seed "${word}": no pronunciation found.`);
    }
    throw new Error(
      `Cannot pin seed "${word}": ${keys.length} pronunciations (${keys.join(", ")}). Pass a rhymeKey.`,
    );
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

    const prons = this.#data.pronunciations.get(word) ?? [];
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
   * Build the complete Puzzle for a Seed Word: every wordhood-valid rhyming word,
   * split into disjoint Answers and Bonus Words, each carrying length and
   * knownness. Deterministic — members are sorted, so the same Seed Word always
   * yields an identical Puzzle.
   */
  buildPuzzle(seed: SeedWord): Puzzle {
    const answers: PuzzleEntry[] = [];
    const bonusWords: PuzzleEntry[] = [];
    const seedWord = normaliseWord(seed.word);

    for (const [word, prons] of this.wordhoodEntries()) {
      if (word === seedWord) continue;
      const match = this.#matchingPronunciation(seed.rhymeKey, prons);
      if (!match) continue;

      const { tier, knownness } = this.#tier(word);
      const entry: PuzzleEntry = {
        word,
        length: word.length,
        knownness,
        pronunciation: match,
        respelling: respell(match),
      };
      (tier === "answer" ? answers : bonusWords).push(entry);
    }

    const byWord = (a: PuzzleEntry, b: PuzzleEntry) => a.word.localeCompare(b.word);
    answers.sort(byWord);
    bonusWords.sort(byWord);
    return { seed, answers, bonusWords };
  }

  #matchingPronunciation(
    seedKey: RhymeKey,
    prons: Pronunciation[],
  ): Pronunciation | null {
    for (const pron of prons) {
      if (rhymeKeyOf(pron) === seedKey) return pron;
    }
    return null;
  }

  /**
   * Tier a rhyming, wordhood-valid word by knownness. Lemmatise before the
   * lookup (never before rhyme matching). A word absent from the prevalence data
   * defaults to Bonus, so a coverage gap never refuses a real word (ADR-0003).
   */
  #tier(word: string): { tier: Tier; knownness: number | null } {
    for (const candidate of lemmaCandidates(word)) {
      const score = this.#data.prevalence.get(candidate);
      if (score !== undefined) {
        return {
          tier: score >= this.#config.knownnessThreshold ? "answer" : "bonus",
          knownness: score,
        };
      }
    }
    return { tier: "bonus", knownness: null };
  }
}
