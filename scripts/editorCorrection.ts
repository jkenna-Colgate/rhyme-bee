/**
 * The **correction** half of judging a Candidate: an agent proposes a reading
 * for a word the engine already reads wrongly, the editor approves it, and the
 * days the word's Rhyme Keys reach are rechecked (#180).
 *
 * Two acts, kept apart on purpose.
 *
 * `proposeCorrection` **writes nothing anywhere**. It gathers the same evidence
 * the add path gathers, hands it to the same `AgentAuthor` seam, and returns
 * what came back beside what the engine currently says. A proposal the editor
 * disagrees with costs nothing, which is what makes approving one a judgement
 * rather than a rubber stamp (ADR-0017).
 *
 * `applyCorrection` is the write, and it keeps the write inside it for the
 * reason `add` does: a correction's whole point is the write, both the browser
 * and any later caller need it to happen server-side (ADR-0016), and a value
 * that merely *described* a write some other layer had to remember to perform is
 * a bug waiting for the layer that forgets.
 *
 * ## Replace and join, and why neither touches the merge
 *
 * `applySupplement` sets a word's readings to whatever the supplement parses for
 * it, and `parseCmudict` merges a word's alternate-pronunciation entries —
 * `tear`, `tear(2)` — into one set. So the two modes are two *contents* for the
 * same mechanism: a replace writes one line, a join writes the engine's readings
 * and the new one as alternates. **Nothing in `src/supplement.ts` or
 * `src/cmudict.ts` changes, and no new syntax is introduced** (ADR-0017); a
 * Submission then rhymes on either pronunciation because adjudication already
 * accepts a match on *any* of a word's Rhyme Keys.
 *
 * The readings a join carries over are the ones **the engine holds and the
 * editor was shown** — post-supplement and post-Normalisation, which is what the
 * proposal was displayed beside. Writing back the raw upstream readings instead
 * would mean approving one thing and writing another, and would need a second
 * context assembled a second way.
 *
 * The cost is narrower and sharper than "an accepted cost", and worth naming
 * exactly. An *appending* normalisation is admissible only while its reach has
 * been measured and its error rate stated (ADR-0010) — which is a guardrail on a
 * rule that can be re-measured, tightened or withdrawn, with every reading it
 * appended going away with it. A join copies such a reading into
 * `data/supplement.dict`, where it stops being the rule's output and becomes a
 * committed fact about the word: it survives the re-measurement, and survives
 * the withdrawal of the rule that produced it. So this is a deliberate escape
 * from that guardrail, not an oversight in it — one word wide, and paid only
 * where an editor chose join over replace, with the readings in front of them.
 * Nothing here prevents it, by design (#180): the supplement is the permanent
 * override layer (ADR-0009), and this is what overriding permanently means.
 *
 * ## The recheck follows the union of the keys
 *
 * A join leaves the word on its old Rhyme Key and adds a new one; a replace
 * moves it. Rechecking the days for the union of the word's keys **before and
 * after** covers both without the caller needing to know which happened. The
 * schedule holds 260 days over 260 distinct Rhyme Keys, so a key reaches at most
 * one day and the recheck is a handful of days at ~90 ms each.
 *
 * ## What arrives as an argument
 *
 * The evidence context, the schedule, the index opener and the agent author, for
 * the reason `readScheduledDay`'s index and `resolveAddOutcome`'s context do:
 * it is what makes the whole of this callable over a fixture with nothing on
 * disk and no subprocess in flight, which is the whole of what makes it
 * testable.
 */

import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normaliseWord } from "../src/cmudict.ts";
import { rhymeKeyOf, type Pronunciation, type RhymeKey } from "../src/phonology.ts";
import { respell } from "../src/respelling.ts";
import type { PuzzleFacts, Schedule, ScheduleDay } from "../src/schedule.ts";
import { gatherEvidence, type EvidenceContext } from "../src/supplementEvidence.ts";
import type { RhymeIndex } from "../src/rhymeIndex.ts";
import type { RebuildResult } from "../web/src/editor/add.ts";
import type {
  CorrectionMode,
  CorrectionOutcome,
  CorrectionWriteResult,
  DayMovement,
} from "../web/src/editor/correction.ts";
import { authorWithAgent, type AgentAuthor } from "./editorAdd.ts";
import { readScheduledDay, type DayReadout } from "./editorDay.ts";
import { root } from "./editorShell.ts";

/**
 * Ask an agent for a corrected reading, and write nothing.
 *
 * The word is judged against the same `gatherEvidence` the add path judges it
 * with, under the same context, so "the engine already reads this and the
 * reading is wrong" means here exactly what `needs-correction` means on the
 * Candidate Queue readout (`scripts/editorCandidates.ts`). The two states cannot
 * disagree, because they are one call to one function.
 *
 * A word with no reading, or one that already reaches the target, comes back
 * `nothing-to-correct` **without the agent being asked**: neither is a
 * correction, and spending a minute of agent time to say so would be a minute
 * spent on the one answer already known.
 */
export async function proposeCorrection(
  word: string,
  target: RhymeKey,
  ctx: EvidenceContext,
  authorReading: AgentAuthor = authorWithAgent,
): Promise<CorrectionOutcome> {
  const evidence = gatherEvidence(word, target, ctx);
  const identity = { word: evidence.word, target, current: evidence.direct };

  if (evidence.direct.length === 0 || evidence.rhymesDirectly) {
    return {
      ...identity,
      outcome: "nothing-to-correct",
      rhymesDirectly: evidence.rhymesDirectly,
    };
  }

  const authored = await authorReading(evidence);
  if (authored === null) return { ...identity, outcome: "agent-unavailable" };

  return {
    ...identity,
    outcome: "proposed",
    phonemes: authored,
    key: rhymeKeyOf(authored),
    respelling: respell(authored),
    // Reported rather than enforced: a proposal that misses the target is the
    // word's honest reading, and approving it is what makes the engine say
    // "doesn't rhyme" rather than "not a word we know" (#176).
    reaches: rhymeKeyOf(authored) === target,
  };
}

/** One approved correction, as the caller names it. */
export interface CorrectionAsk {
  word: string;
  /** The Rhyme Key the Candidate was aimed at. Carried through for the readout. */
  target: RhymeKey;
  /** The reading being approved — the agent's proposal, echoed back. */
  phonemes: Pronunciation;
  mode: CorrectionMode;
}

/**
 * What `applyCorrection` takes from a caller instead of reaching for itself.
 *
 * `context` is read **before** the write, because the word's readings before the
 * correction are half of the union the recheck follows and the whole of what a
 * join carries over. `openIndex` is a function and is called on both sides of
 * `rebuild`, which is the entire reason it is not an index: it is how the days
 * are read off the old artifact and then off the new one.
 */
export interface CorrectionDeps {
  context: () => EvidenceContext;
  schedule: () => Schedule;
  openIndex: () => RhymeIndex;
  rebuild: () => Promise<RebuildResult>;
  /** Where the reading lands. `data/supplement.dict`, live. */
  supplementPath?: string;
}

/**
 * Approve a correction: write it, rebuild the Rhyme Index, and report what moved
 * on the days the word's Rhyme Keys reach.
 *
 * The order is not negotiable and is the add route's own: the days are read
 * **before** anything is written, the readings are written, the index is rebuilt,
 * and the days are read again. Reading the "before" side after the write would
 * report no movement at all, and rebuilding before the write would fold in
 * nothing.
 *
 * The recheck runs whether or not the rebuild succeeded. A failed rebuild leaves
 * the old artifact on disk, so the "after" read returns the same figures as the
 * "before" one and every day reads as unmoved — which is true of the artifact
 * and is exactly what the editor needs to know, alongside `rebuilt` saying why.
 */
export async function applyCorrection(
  ask: CorrectionAsk,
  deps: CorrectionDeps,
): Promise<CorrectionWriteResult> {
  const word = normaliseWord(ask.word);
  const ctx = deps.context();
  const schedule = deps.schedule();

  const current = ctx.pronunciations.get(word) ?? [];
  const written = readingsToWrite(current, ask.phonemes, ask.mode);
  const keysBefore = keysOf(current);
  const keysAfter = keysOf(written);
  const rechecked = union(keysBefore, keysAfter);

  const days = daysOnKeys(schedule, rechecked);
  const before = days.map((day) => readDay(deps.openIndex, schedule, day.date));

  appendCorrection(
    deps.supplementPath ?? resolve(root, "data", SUPPLEMENT),
    { word, mode: ask.mode, target: ask.target, readings: written },
  );
  const rebuilt = await deps.rebuild();
  const after = days.map((day) => readDay(deps.openIndex, schedule, day.date));

  return {
    word,
    mode: ask.mode,
    written,
    keysBefore,
    keysAfter,
    rechecked,
    rebuilt,
    days: days.map((day, i) => movementOf(word, day, before[i]!, after[i]!)),
  };
}

/**
 * The readings one approved correction writes, in file order.
 *
 * **Replace** is the proposal alone, which is what a supplement entry has always
 * done. **Join** is every reading the engine holds followed by the proposal, so
 * the parser's existing alternate-pronunciation merge puts all of them back into
 * one set — the word is then accepted on either pronunciation, because a
 * Submission rhymes if any of its Rhyme Keys matches (CONTEXT.md, **Rhyme**).
 *
 * A proposal the engine already holds is written once rather than twice. A
 * duplicate line is inert to the parser, but it is a line a later reader has to
 * work out is a duplicate, and the editor did not approve saying a thing twice.
 */
export function readingsToWrite(
  current: readonly Pronunciation[],
  proposed: Pronunciation,
  mode: CorrectionMode,
): Pronunciation[] {
  if (mode === "replace") return [proposed];
  const seen = new Set<string>();
  const out: Pronunciation[] = [];
  for (const reading of [...current, proposed]) {
    const spelling = reading.join(" ");
    if (seen.has(spelling)) continue;
    seen.add(spelling);
    out.push(reading);
  }
  return out;
}

/** Every Rhyme Key a set of readings computes to, deduplicated, unstressed dropped. */
function keysOf(readings: readonly Pronunciation[]): RhymeKey[] {
  const keys: RhymeKey[] = [];
  for (const reading of readings) {
    const key = rhymeKeyOf(reading);
    if (key !== null && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

function union(a: readonly RhymeKey[], b: readonly RhymeKey[]): RhymeKey[] {
  return [...a, ...b.filter((key) => !a.includes(key))];
}

/**
 * The scheduled days the given Rhyme Keys reach, in schedule order.
 *
 * The run holds 260 days over 260 distinct keys, so this is at most one day per
 * key and usually none: most Candidates are aimed at a key the schedule never
 * dealt. A key with no day is simply not represented, which is right — there is
 * no day to recheck and nothing to say about one.
 */
export function daysOnKeys(schedule: Schedule, keys: readonly RhymeKey[]): ScheduleDay[] {
  return schedule.days.filter((day) => keys.includes(day.rhymeKey));
}

/**
 * One day, or `null` for a day that would not read.
 *
 * A day the index cannot build is not a failed correction — the reading is
 * written and the rebuild has run — so it is reported as a day with no figures
 * rather than thrown past a write that already happened.
 */
function readDay(openIndex: () => RhymeIndex, schedule: Schedule, date: string): DayReadout | null {
  try {
    return readScheduledDay(openIndex, schedule, date);
  } catch {
    return null;
  }
}

/**
 * What one day did, held between its two reads.
 *
 * `moved` is the whole question. It is true when any of the three figures
 * changed *or* when the corrected word entered or left the day's lists — the
 * second is not implied by the first, because a Bonus Word arriving moves no
 * figure at all (Bonus Words are not counted, CONTEXT.md) and is still the word
 * appearing on a Puzzle it was not on.
 *
 * The day's identity comes from the **schedule** rather than from either
 * readout, so a day the index could not build is still named. The schedule is a
 * reviewed artifact (ADR-0012) and is the thing that says which day sits on
 * which Rhyme Key; a readout is what the index made of it, and there may not be
 * one.
 *
 * Exported so the union-of-keys recheck can be driven over two fixture readouts
 * with no index, no schedule and no rebuild — which is what a caller can observe
 * of it, and the only thing worth asserting.
 */
export function movementOf(
  word: string,
  day: Pick<ScheduleDay, "date" | "seed" | "rhymeKey">,
  before: DayReadout | null,
  after: DayReadout | null,
): DayMovement {
  const heldBefore = holds(before, word);
  const heldAfter = holds(after, word);
  const factsBefore = factsOf(before);
  const factsAfter = factsOf(after);
  return {
    date: day.date,
    seed: day.seed,
    rhymeKey: day.rhymeKey,
    before: factsBefore,
    after: factsAfter,
    heldBefore,
    heldAfter,
    moved: heldBefore !== heldAfter || !sameFacts(factsBefore, factsAfter),
  };
}

function factsOf(readout: DayReadout | null): PuzzleFacts | null {
  return readout !== null && readout.outcome === "day" ? readout.facts : null;
}

function holds(readout: DayReadout | null, word: string): boolean {
  if (readout === null || readout.outcome !== "day") return false;
  return (
    readout.answers.some((w) => w.word === word) ||
    readout.bonusWords.some((w) => w.word === word)
  );
}

function sameFacts(a: PuzzleFacts | null, b: PuzzleFacts | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.answerCount === b.answerCount && a.maxScore === b.maxScore && a.difficulty === b.difficulty
  );
}

const SUPPLEMENT = "supplement.dict";

/**
 * The section approved corrections append to, written once.
 *
 * Its own section rather than the adds', because the two are different acts on
 * the same file and a reader wants to know which one a line came from: an add
 * fills a gap the pinned sources left, and a correction overrides something they
 * assert. `EDITOR_SECTION` in `scripts/editorAdd.ts` says what it says for the
 * same reason.
 */
const CORRECTION_SECTION =
  "# --- Corrections approved in the Editor's Pass: an agent proposed the reading and\n" +
  "# the editor approved it against the engine's own (ADR-0009, ADR-0017). ---";

interface CorrectionEntry {
  word: string;
  mode: CorrectionMode;
  target: RhymeKey;
  readings: Pronunciation[];
}

/**
 * Append one correction to the committed supplement: a comment saying what was
 * approved and why, then the reading — or, for a join, the readings as
 * **alternate-pronunciation entries** in the format `parseCmudict` has always
 * merged.
 *
 * The comment is a whole line rather than a trailing gloss, because the parser
 * only strips lines that *start* with `#` and would otherwise read a gloss's
 * words as phonemes. It is worth writing where the add path's is not: an add's
 * reason is constant and restating it carries no information, whereas which of
 * two things a correction did — replaced a reading, or joined one — is exactly
 * what a later reader cannot recover from the lines themselves.
 *
 * A file whose last line lost its newline is repaired on the way in rather than
 * trusted, which is `web/declinesFile.ts`'s argument: a fused line here would
 * make the head word `supplement.dictword` and the entry would simply vanish
 * from the merge, silently.
 */
function appendCorrection(path: string, entry: CorrectionEntry): void {
  const existing = readFileSync(path, "utf8");
  const opener = existing === "" || existing.endsWith("\n") ? "" : "\n";
  const section = existing.includes(CORRECTION_SECTION) ? "" : `\n${CORRECTION_SECTION}\n`;
  appendFileSync(path, `${opener}${section}${correctionLines(entry)}\n`);
}

/** The comment and the entries for one correction, as text. */
export function correctionLines({ word, mode, target, readings }: CorrectionEntry): string {
  const note =
    mode === "join"
      ? `# ${word}: correction approved in the Editor's Pass, against ${target} — joins the ` +
        `engine's reading as an alternate rather than replacing it, so the word is accepted on ` +
        `either pronunciation (ADR-0017).`
      : `# ${word}: correction approved in the Editor's Pass, against ${target} — replaces every ` +
        `reading the pinned sources hold for this word (ADR-0009).`;
  const entries = readings.map(
    (phonemes, i) => `${word}${i === 0 ? "" : `(${i + 1})`} ${phonemes.join(" ")}`,
  );
  return [note, ...entries].join("\n");
}
