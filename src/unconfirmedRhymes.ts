/**
 * The **Unconfirmed Rhymes**: words the Judge ruled a Rhyme on one Rhyme Key
 * that nobody has confirmed yet (GLOSSARY.md, ADR-0017 amended, ADR-0011
 * amended 2026-10-14). A listed word is accepted on its key without Points: the
 * player sees a Bonus Word, and no Score, Rank or Difficulty moves.
 *
 * ## Why the key is the pair
 *
 * The list is not a reading and not a Tier. A reading follows its word into
 * every Puzzle, and a Tier belongs to the word; an Unconfirmed Rhyme belongs to
 * the word aimed at one Rhyme Key, so `clique` listed for `trick` still scores
 * for `week`. It holds on every day that key is played, whichever word of the
 * family is the Seed Word (ADR-0001 amended).
 *
 * ## The format
 *
 * One Unconfirmed Rhyme per line, `#` comments and blanks ignored:
 *
 *     clique judge:claude-sonnet-4-5 overrule high IH K
 *     <word> <writer>                <ruling> <confidence> <rhyme key>
 *
 * The writer is one token naming who wrote the line (the Judge and its model,
 * for every line the landing step writes). The ruling and its confidence say
 * which row of ADR-0017's table made it: a `missing-reading` (the game had no
 * reading at all) or an `overrule` (it had one that misses the key). Both are
 * what the Editor's Pass shows beside the line. The Rhyme Key runs to the end of
 * the line, as in `data/declines.txt`, because a key contains spaces.
 *
 * A malformed line is **dropped and reported**, not thrown over. A dropped line
 * costs the player the verdict the engine would have given anyway, and the file
 * is written by an unattended job: a build that refused to run over one bad line
 * would stay broken with nobody there to mend it.
 */

import { normaliseWord } from "./cmudict.ts";
import { isRhymeKeyShape } from "./declines.ts";
import type { RhymeKey } from "./phonology.ts";

/** Which row of ADR-0017's table made the line, named for what the game knew. */
export type UnconfirmedRuling = "missing-reading" | "overrule";

/** How sure the Judge said it was. Its own figure, never the word's difficulty. */
export type JudgeConfidence = "high" | "medium" | "low";

const RULINGS: readonly UnconfirmedRuling[] = ["missing-reading", "overrule"];
const CONFIDENCES: readonly JudgeConfidence[] = ["high", "medium", "low"];

export interface UnconfirmedRhyme {
  word: string;
  rhymeKey: RhymeKey;
  /** Who wrote the line: one token, such as `judge:<model id>`. */
  writer: string;
  ruling: UnconfirmedRuling;
  confidence: JudgeConfidence;
}

/** A single token: no whitespace, and no `#`, which would start a comment. */
const TOKEN = /^[^\s#]+$/;

/**
 * Serialise one Unconfirmed Rhyme as a single newline-terminated line, ready to
 * append. The word is normalised here so the file holds the one spelling the
 * adjudicator looks it up under. A writer that is not one token, or a key not
 * spelled like a Rhyme Key, throws: the line would not read back.
 */
export function serialiseUnconfirmedRhyme(entry: UnconfirmedRhyme): string {
  const rhymeKey = entry.rhymeKey.trim();
  if (!TOKEN.test(entry.writer)) {
    throw new Error(`Unconfirmed Rhyme writer "${entry.writer}" must be one token with no "#".`);
  }
  if (!isRhymeKeyShape(rhymeKey)) {
    throw new Error(`Unconfirmed Rhyme key "${entry.rhymeKey}" is not spelled like a Rhyme Key.`);
  }
  return `${normaliseWord(entry.word)} ${entry.writer} ${entry.ruling} ${entry.confidence} ${rhymeKey}\n`;
}

export interface ParsedUnconfirmedRhymes {
  entries: UnconfirmedRhyme[];
  /** Every line that did not read, as written, so the build can name it. */
  malformed: string[];
}

/** Parse the list. See the module comment for why a bad line is dropped. */
export function parseUnconfirmedRhymes(text: string): ParsedUnconfirmedRhymes {
  const entries: UnconfirmedRhyme[] = [];
  const malformed: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split("#")[0]!.trim();
    if (line === "") continue;
    const [word, writer, ruling, confidence, ...key] = line.split(/\s+/);
    const rhymeKey = key.join(" ");
    if (
      word === undefined ||
      writer === undefined ||
      !(RULINGS as readonly string[]).includes(ruling ?? "") ||
      !(CONFIDENCES as readonly string[]).includes(confidence ?? "") ||
      !isRhymeKeyShape(rhymeKey)
    ) {
      malformed.push(line);
      continue;
    }
    entries.push({
      word: normaliseWord(word),
      rhymeKey,
      writer,
      ruling: ruling as UnconfirmedRuling,
      confidence: confidence as JudgeConfidence,
    });
  }
  return { entries, malformed };
}

/** The list as the build applied it, so the build can say what it dropped. */
export interface AppliedUnconfirmedRhymes {
  /** The lines that stand: accepted without Points on their key. */
  kept: UnconfirmedRhyme[];
  /**
   * Lines whose word now rhymes on its key by itself. Confirming a line is the
   * ordinary add (a reading in `data/supplement.dict`), which leaves the line
   * with nothing to do; the build drops it rather than let it outlive its use.
   */
  stale: UnconfirmedRhyme[];
  /**
   * Lines whose word `data/demotions.txt` names, for either reason. A Demotion
   * is the editor's ruling and a line is the Judge's, so the Demotion wins and
   * the player receives its reason, as if the line were not there.
   */
  demoted: UnconfirmedRhyme[];
  /** Lines that did not read, as written. */
  malformed: string[];
}

/** What the build knows that decides whether a line still stands. */
export interface UnconfirmedRhymeContext {
  /** The index's own rhyme rule over the built data, so it is never restated. */
  rhymesByItself: (word: string, rhymeKey: RhymeKey) => boolean;
  /** Every word the demotion list names. */
  demotedWords: ReadonlySet<string>;
}

/**
 * Apply the list over finished readings: parse it, then set aside every line a
 * Demotion overrules and every line that has gone stale.
 */
export function applyUnconfirmedRhymes(
  text: string,
  { rhymesByItself, demotedWords }: UnconfirmedRhymeContext,
): AppliedUnconfirmedRhymes {
  const { entries, malformed } = parseUnconfirmedRhymes(text);
  const kept: UnconfirmedRhyme[] = [];
  const stale: UnconfirmedRhyme[] = [];
  const demoted: UnconfirmedRhyme[] = [];
  for (const entry of entries) {
    if (demotedWords.has(entry.word)) demoted.push(entry);
    else if (rhymesByItself(entry.word, entry.rhymeKey)) stale.push(entry);
    else kept.push(entry);
  }
  return { kept, stale, demoted, malformed };
}

/** Word to the Rhyme Keys it is listed for: the shape adjudication reads. */
export function unconfirmedKeysByWord(entries: readonly UnconfirmedRhyme[]): Map<string, RhymeKey[]> {
  const byWord = new Map<string, RhymeKey[]>();
  for (const { word, rhymeKey } of entries) {
    const keys = byWord.get(word) ?? [];
    if (!keys.includes(rhymeKey)) keys.push(rhymeKey);
    byWord.set(word, keys);
  }
  return byWord;
}

/** A scheduled day whose Seed Word the list holds, and the keys it is listed for. */
export interface ListedSeedWord {
  date: string;
  seed: string;
  listedFor: RhymeKey[];
}

/**
 * Every scheduled day whose Seed Word is on the list, on any Rhyme Key. Seed
 * Words and Unconfirmed Rhymes are kept apart (ADR-0012 amended): a listed Seed
 * Word would make every word of the other family an accepted guess on its own
 * day, since a Rhyme holds both ways. The build reports such a day rather than
 * repair it, because which side gives way is the editor's ruling.
 */
export function listedSeedWords(
  days: readonly { date: string; seed: string }[],
  entries: readonly UnconfirmedRhyme[],
): ListedSeedWord[] {
  const byWord = unconfirmedKeysByWord(entries);
  const listed: ListedSeedWord[] = [];
  for (const { date, seed } of days) {
    const keys = byWord.get(normaliseWord(seed));
    if (keys !== undefined) listed.push({ date, seed, listedFor: keys });
  }
  return listed;
}

/**
 * The list with every line for one word on one Rhyme Key taken off, comments
 * and every other line kept as written. This is what a Decline does to an
 * Unconfirmed Rhyme (ADR-0017 amended): the word gets the engine's own verdict
 * on that key again. A line that does not read is left alone, as the build
 * leaves it.
 */
export function withoutUnconfirmed(text: string, word: string, rhymeKey: RhymeKey): { text: string; removed: number } {
  const target = normaliseWord(word);
  let removed = 0;
  const kept = text.split(/(?<=\n)/).filter((raw) => {
    const { entries } = parseUnconfirmedRhymes(raw);
    const hit = entries.length === 1 && entries[0]!.word === target && entries[0]!.rhymeKey === rhymeKey;
    if (hit) removed += 1;
    return !hit;
  });
  return { text: kept.join(""), removed };
}
