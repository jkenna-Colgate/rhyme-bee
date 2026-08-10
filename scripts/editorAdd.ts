/**
 * The other half of the Editor's Pass: **adding** a word the read turned up as
 * missing. Composition, the agent shell-out, the append to
 * `data/supplement.dict` and the deferred queue. Reads the pinned sources
 * directly and never opens the built Rhyme Index.
 *
 * `add` takes words and nothing else — no phonemes, ever. It composes a reading
 * from a compound split, hands what it cannot resolve to an agent, and holds
 * both to the same verification before either reaches `data/supplement.dict`
 * (ADR-0014). What still fails is appended to the deferred queue rather than
 * discarded, which is what makes the miss rate countable.
 *
 * `add` used to judge each word and print the judgement in the same breath,
 * which is why it was unreachable by anything that is not a terminal (#150).
 * `resolveAddOutcome` is the split: the judgement, as a value, with the
 * pinned-source context and the agent call both arriving as arguments rather
 * than being read here — the same move `readScheduledDay` (`editorDay.ts`)
 * makes for the day half of the pass, for the same reason. `add` stays the
 * real entry point: it builds the real context, calls `resolveAddOutcome`,
 * performs the writes the outcome names, and returns the value. `printAddOutcome`
 * is the one renderer left over it, so the CLI's output is unchanged.
 *
 * The writes are kept in `add` rather than pushed out to a caller, unlike
 * `readScheduledDay`'s pure read: an add's whole point is the write, the web
 * mode needs it server-side regardless of which surface asked for it
 * (ADR-0016), and a value that only *describes* a write some other layer must
 * remember to perform is a bug waiting for a caller that forgets.
 *
 * The judgement (`resolveAddOutcome`, `gatherEvidence`, `composeReading`,
 * `verifyReading`) is tested; `add` itself is not, following the rest of the
 * pass's shell — it is a context read, a call and two file writes. The agent
 * invocation is untested by the same precedent; the reading of what comes back
 * is a gate on the core rather than a neighbour of it, so it lives in
 * `editorReading.ts` and is tested there.
 */

import { spawn } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCmudict } from "../src/cmudict.ts";
import type { Pronunciation, RhymeKey } from "../src/phonology.ts";
import { parseWordList } from "../src/pipeline.ts";
import type { Schedule } from "../src/schedule.ts";
import { applySupplement } from "../src/supplement.ts";
import {
  evidenceContextFrom,
  gatherEvidence,
  verifyReading,
  type ComposedReading,
  type EvidenceContext,
  type ReadingEvidence,
  type WordReading,
} from "../src/supplementEvidence.ts";
import { killTree } from "../web/killTree.ts";
import { parseReading } from "./editorReading.ts";
import { fail, root } from "./editorShell.ts";

/**
 * What an add is aimed at: one Rhyme Key, and where that key came from. The two
 * travel together because the provenance is printed beside the key — a night's
 * add is auditable from its own output only if the readout says whether the
 * editor typed the key or the schedule supplied it.
 */
export interface AddTarget {
  target: RhymeKey;
  provenance: string;
  /**
   * The Seed Word the key belongs to, when the aim came from a scheduled day.
   * Absent when the editor named a Rhyme Key outright on the command line —
   * there is no Puzzle behind that aim and therefore no Seed.
   *
   * It exists because a `reads-on-another-key` outcome can be recorded as a
   * Candidate, and a Candidate names the Seed Word the disagreement is about
   * (#163). Read out of `provenance` it would be a sentence being parsed for a
   * value it was written to *read* well, and taken from the day on screen it
   * would be the wrong Seed the moment the editor looked at a neighbouring day
   * with a batch's outcome still showing — a Candidate that looks right and
   * names a Puzzle the word was never held against. So the outcome carries the
   * Seed it was actually aimed at.
   */
  seed?: string;
}

/**
 * An aim taken from a scheduled day, where the Seed Word is not in question.
 *
 * `AddTarget.seed` is optional because one aim genuinely has no Seed — the
 * command line's `--rhymeKey`, which names a Rhyme Key outright with no Puzzle
 * behind it. That optionality is correct for the union of the two aims and
 * wrong for either one taken alone: every aim `targetIn` builds comes off a
 * scheduled day and therefore *always* carries a Seed, and typing it as though
 * it might not made a real gap on the screen. The browser's record-a-
 * disagreement button needs the Seed Word, so it rendered `seed !== null &&
 * (…)` and a null Seed made the button silently vanish — the editor watching a
 * word do nothing, which is the exact failure the gesture exists to prevent.
 *
 * Narrowing here rather than making `seed` required on `AddTarget` because the
 * `--rhymeKey` aim is not a degenerate scheduled one, it is a second kind of
 * aim, and a required field would have to be filled with a lie. It does not
 * reach all the way to the browser either: `AddOutcome.seed` stays optional
 * because the outcome is the union again, and a wire type cannot carry a
 * guarantee about which caller built it. What this buys is that the one server
 * path a browser can reach (`web/editorAddPlugin.ts`, which aims only through
 * `targetIn`) provably has a Seed — so the null case on screen is a sentence
 * about the CLI's aim rather than a hole the web mode can fall into.
 */
export interface ScheduledAddTarget extends AddTarget {
  seed: string;
}

/**
 * A word that needed nothing: a Proper Noun, refused outright. The space of
 * names is unbounded and has no defensible edge, however well the name
 * rhymes. It is its own case rather than a `deferred` reason — deferring
 * says "later", and a name is never coming back.
 */
export interface RefusedNameOutcome {
  outcome: "refused-name";
  word: string;
}

/**
 * A word CMUdict already reads on the target Rhyme Key: the reading an add would
 * have written is there, so there is nothing to add. It does **not** follow that
 * the word is in the Puzzle. Reading on the key is one of three properties, and
 * an add supplies only this one — a demoted word has no wordhood and appears in
 * neither list however well it reads, and a word that does have wordhood holds a
 * Tier that decides whether it is an Answer or a Bonus Word. Saying "it is in
 * the Puzzle already" would state a conclusion this outcome cannot reach, and
 * the sentence `web/src/editor/AddQueueView.tsx` renders is written to the same
 * limit.
 *
 * Distinguished from `ReadsOnAnotherKeyOutcome` because the two look alike (both
 * are "no write happened") but mean opposite things to the editor reading the
 * outcome: this one is confirmation, that one is a problem.
 *
 * Carries `readings` for the same reason `ReadsOnAnotherKeyOutcome` does: a
 * word can hold more than one CMUdict entry, and confirming *which* reading
 * is the one on the target key is still worth showing, not only the fact of
 * agreement.
 */
export interface AlreadyReadsOutcome {
  outcome: "already-reads";
  word: string;
  readings: ReadingEvidence[];
}

/**
 * A word CMUdict already reads, but not on the target key — a correction
 * rather than an add, and left alone here exactly as it always has been
 * (overriding an upstream pronunciation stays a deliberate hand-edit in
 * `data/supplement.dict`, never something this program does on its own
 * judgement).
 *
 * Carries every direct reading CMUdict holds for the word, keys included —
 * where the index holds it *now* — because a maintainer reading this outcome
 * cannot act on "it disagrees" without also being told what it currently
 * says. The browser names every one of them beside its key, and records the
 * *first* as the engine's respelling when the editor says the word rhymes
 * anyway — `web/src/editor/disagreement.ts` argues why that is the reading the
 * engine itself would have shown (#163). Nothing on either path proposes a
 * correction; recording the disagreement is the whole of what is offered.
 */
export interface ReadsOnAnotherKeyOutcome {
  outcome: "reads-on-another-key";
  word: string;
  readings: ReadingEvidence[];
}

/**
 * A word given a reading and written to `data/supplement.dict`: either
 * composed from a compound split (`composed` carries the parts, for a reader
 * who wants to check the derivation) or authored by the agent once no split
 * reached the target (`composed` is null). Either way the reading passed the
 * same `verifyReading` before arriving here (ADR-0014) — this case does not
 * distinguish the two paths by trustworthiness, only by provenance.
 */
export interface WrittenOutcome {
  outcome: "written";
  word: string;
  phonemes: Pronunciation;
  composed: ComposedReading | null;
}

/**
 * A word neither composed nor authored: no compound split reached the target,
 * and the agent either did not answer (`agent-unavailable`) or proposed a
 * reading that failed the same verification a human proposal would fail
 * (`agent-reading-failed-verification`, and `proposed` carries what it said so
 * the miss is inspectable). Appended to the deferred queue rather than
 * discarded, so the composition's real miss rate is countable and a night's
 * words are not silently retried next time.
 */
export interface DeferredOutcome {
  outcome: "deferred";
  word: string;
  reason: "agent-unavailable" | "agent-reading-failed-verification";
  proposed: Pronunciation | null;
}

export type WordOutcome =
  | RefusedNameOutcome
  | AlreadyReadsOutcome
  | ReadsOnAnotherKeyOutcome
  | WrittenOutcome
  | DeferredOutcome;

/**
 * The whole of one `add` invocation, as a value: the aim it ran against — the
 * Rhyme Key, where that key came from, and the Seed Word behind it when there
 * was one — and every supplied word's outcome in the order it was given.
 * `printAddOutcome`
 * below is the one renderer over it; a later slice's React view is the other
 * (#150).
 *
 * Flat rather than pre-partitioned into written/deferred lists — `words` is
 * the one list, each entry self-describing via `outcome`, so a reader who
 * wants the partition filters it (as `printAddOutcome`, `writtenReadings` and
 * `deferredReadings` below all do) and a reader who wants the original order
 * an editor typed the words in still has it. Two lists would have to agree on
 * an order convention neither the CLI nor a browser table actually needs.
 */
export interface AddOutcome {
  target: RhymeKey;
  provenance: string;
  /** The aim's Seed Word, carried through unchanged — see `AddTarget.seed`. */
  seed?: string;
  words: WordOutcome[];
}

/** How an add asks an agent to author a reading — real in `add`, stubbed in tests. */
type AgentAuthor = (word: string, target: RhymeKey) => Promise<Pronunciation | null>;

/**
 * The editor names words the pass turned up as missing, and nothing else — no
 * phonemes, and no per-entry comment, because the reason for an add is constant
 * (the word was absent from the pinned sources) and restating it every time
 * carries no information.
 *
 * Per word, in order: a name is refused outright; a word that already reads is
 * a correction and is left alone; otherwise a reading is composed from a
 * compound split, and if no split reaches the target the word goes to an agent
 * to author. Every proposal, whoever made it, passes the same `verifyReading`
 * before it is accepted (ADR-0014). Anything that still fails is a `deferred`
 * case, so a miss is recorded rather than rediscovered next time.
 *
 * The words are independent of one another: every one is judged against the
 * same `ctx`, taken before the first of them, so their order carries no
 * meaning and no word can be a part of another's compound split within one
 * invocation.
 *
 * `ctx` and `authorReading` arrive as arguments rather than being read or
 * shelled out to here, the same move `readScheduledDay` makes for its index:
 * it is what makes this function callable over a fixture with a stubbed
 * agent, with no pinned source on disk and no subprocess in flight, which is
 * the whole of what makes it testable. `add` below supplies the real ones.
 */
export async function resolveAddOutcome(
  words: string[],
  aim: AddTarget,
  ctx: EvidenceContext,
  authorReading: AgentAuthor = authorWithAgent,
): Promise<AddOutcome> {
  const { target, provenance, seed } = aim;
  const results: WordOutcome[] = [];

  for (const supplied of words) {
    const evidence = gatherEvidence(supplied, target, ctx);
    const word = evidence.word;

    // A name stays a name, however well it rhymes: the space of names is
    // unbounded and has no defensible edge. Refused rather than deferred —
    // deferring says "later", and this is never.
    if (evidence.isName) {
      results.push({ outcome: "refused-name", word });
      continue;
    }

    if (evidence.direct.length > 0) {
      results.push(
        evidence.rhymesDirectly
          ? { outcome: "already-reads", word, readings: evidence.direct }
          : { outcome: "reads-on-another-key", word, readings: evidence.direct },
      );
      continue;
    }

    if (evidence.composed !== null) {
      results.push({ outcome: "written", word, phonemes: evidence.composed.phonemes, composed: evidence.composed });
      continue;
    }

    const authored = await authorReading(word, target);
    if (authored === null) {
      results.push({ outcome: "deferred", word, reason: "agent-unavailable", proposed: null });
    } else if (verifyReading(authored, target)) {
      // The same predicate, applied to a reading this program did not compose.
      // Delegating authorship does not lower the bar.
      results.push({ outcome: "written", word, phonemes: authored, composed: null });
    } else {
      results.push({ outcome: "deferred", word, reason: "agent-reading-failed-verification", proposed: authored });
    }
  }

  return { target, provenance, seed, words: results };
}

/**
 * The real entry point: builds the real pinned-source context, judges the
 * words against it, writes what `resolveAddOutcome` decided reached a reading
 * to `data/supplement.dict` and what it deferred to the deferred queue, and
 * returns the outcome. Nothing here prints — `printAddOutcome` is the one
 * renderer, and the web mode's Submit is the other consumer of the same value
 * (#150).
 *
 * The writes stay here rather than moving out to a caller: unlike a day
 * reading, which is pure, an add's whole point is the write, and the web mode
 * needs it to happen server-side regardless of which surface asked for it
 * (ADR-0016). A value that only *describes* a write some other layer must
 * remember to perform is a bug waiting for a caller that forgets — every
 * consumer of `AddOutcome` gets a value the write has already happened for.
 */
export async function add(words: string[], aim: AddTarget): Promise<AddOutcome> {
  const outcome = await resolveAddOutcome(words, aim, evidenceContext());
  appendToSupplement(writtenReadings(outcome));
  appendToDeferredQueue(deferredReadings(outcome));
  return outcome;
}

function writtenReadings(outcome: AddOutcome): WordReading[] {
  return outcome.words
    .filter((w): w is WrittenOutcome => w.outcome === "written")
    .map((w) => ({ word: w.word, phonemes: w.phonemes }));
}

function deferredReadings(outcome: AddOutcome): DeferredReading[] {
  return outcome.words
    .filter((w): w is DeferredOutcome => w.outcome === "deferred")
    .map((w) => ({ word: w.word, rhymeKey: outcome.target, reason: w.reason }));
}

/** One word the pass could not resolve, kept so the miss rate is countable. */
interface DeferredReading {
  word: string;
  rhymeKey: RhymeKey;
  reason: "agent-unavailable" | "agent-reading-failed-verification";
}

/**
 * The pinned inputs with the committed supplement merged over them and
 * Normalisation applied on top — the same stack, in the same order, that the
 * index build reads (`src/manufacture.ts`). The target Rhyme Key an add is
 * aimed at always comes from the built artifact or the schedule, so a context
 * assembled any other way judges the evidence under a different phonology from
 * the one that set the target, and loses words to a disagreement about the
 * accent rather than about the rhyme.
 *
 * A **snapshot**, taken once before the loop above and not added to as words
 * are accepted. So a word added on an *earlier* invocation is present and can
 * serve as a part of tonight's next compound — the committed supplement is
 * re-read every time — but a word accepted earlier in *this* invocation is not:
 * `--words=candleholder,candleholders` cannot use the first as a part of the
 * second. That wants a second `editor:add`, once the first one's readings are
 * written.
 *
 * Folding each accepted reading back in as it is accepted would close that, and
 * is a few lines. It is not done because nothing has asked for it: it would
 * make the order of `--words` significant — a word could only ever be a part of
 * a *later* one — in exchange for a compound whose part was itself missing
 * until tonight, which no pass has yet turned up. Worth revisiting from a real
 * night's findings rather than from this comment.
 */
function evidenceContext(): EvidenceContext {
  const read = (name: string) => readFileSync(resolve(root, "data", name), "utf8");
  const pronunciations = parseCmudict(read("cmudict.dict"));
  const words = parseWordList(read("words.txt"));
  const names = parseWordList(read("names.txt"));
  applySupplement(read(SUPPLEMENT), { pronunciations, words, names });
  return evidenceContextFrom({ pronunciations, words, names });
}

/**
 * Ask the agent to author a reading for a word no split resolves, following the
 * pattern the dev feedback button established: the `claude` CLI in headless
 * print mode on the maintainer's Pro subscription, no API key and no new
 * dependency.
 *
 * Never throws, and never waits forever. A missing CLI, a non-zero exit,
 * unparseable output and a process that simply hangs are all the same outcome
 * to the caller — the word is deferred and the night carries on. A tooling
 * problem costs a few words, not the evening.
 */
function authorWithAgent(word: string, target: RhymeKey): Promise<Pronunciation | null> {
  const prompt = [
    `Write the General American CMUdict/ARPAbet pronunciation of the English word "${word}".`,
    `It must rhyme on the Rhyme Key ${target} — that is, the phonemes from its last`,
    `stressed vowel to the end of the word must be exactly: ${target}.`,
    "",
    "Use ARPAbet phonemes with stress digits on vowels (0 unstressed, 1 primary,",
    "2 secondary), separated by single spaces. A compound's final element usually",
    "takes secondary rather than primary stress.",
    "",
    "Respond with ONLY the phonemes on one line. No word, no quotes, no explanation.",
  ].join("\n");

  return new Promise((done) => {
    const child = spawn("claude", ["-p", "--model", "sonnet"], { shell: true });
    let stdout = "";
    let settled = false;
    const settle = (reading: Pronunciation | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done(reading);
    };
    // `error` and `close` between them cover a CLI that is absent and one that
    // fails. Neither fires for one that hangs — waiting on a login prompt at a
    // stdin already closed, or on a stalled network — so the wait is bounded
    // here, and the word takes the path a missing CLI takes.
    const timer = setTimeout(() => {
      killTree(child);
      settle(null);
    }, AGENT_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", () => {});
    child.on("error", () => settle(null));
    child.on("close", (code) => settle(code === 0 ? parseReading(stdout) : null));
    child.stdin.end(prompt);
  });
}

/**
 * How long the agent gets for one word. Headless `claude -p` answers a request
 * this small — one word, one line of ARPAbet — in seconds; a minute means it is
 * not going to, and no amount of further waiting changes that. Erring long
 * because the cost of being wrong is asymmetric: too short defers a word the
 * agent would have authored, too long is the night this bound exists to save.
 */
const AGENT_TIMEOUT_MS = 60_000;

const SUPPLEMENT = "supplement.dict";
const DEFERRED_QUEUE = "deferred-readings.jsonl";

/**
 * The section the pass appends to, written once. There is no per-entry comment
 * — the reason for an add is constant, and a line restating it every time
 * carries no information (ADR-0014).
 */
const EDITOR_SECTION =
  "# --- Adds by the Editor's Pass: composed from a compound split and verified\n" +
  "# against the day's Rhyme Key before being written here (ADR-0014). ---";

function appendToSupplement(readings: WordReading[]): void {
  if (readings.length === 0) return;
  const path = resolve(root, "data", SUPPLEMENT);
  const existing = readFileSync(path, "utf8");
  const section = existing.includes(EDITOR_SECTION) ? "" : `\n${EDITOR_SECTION}\n`;
  const lines = readings.map((r) => `${r.word} ${r.phonemes.join(" ")}`).join("\n");
  appendFileSync(path, `${section}${lines}\n`);
}

/**
 * The deferred queue, in the shape `supplement-candidates.jsonl` established.
 * It is the work list for a later human or agent pass — each entry carries the
 * word and the Rhyme Key it must reach, which is all an author needs — and it
 * is what makes the composition's real miss rate countable. Discarding misses
 * would forfeit that, and a second composition rule is meant to be decided from
 * this file's contents rather than from the next frustrating word.
 */
function appendToDeferredQueue(deferred: DeferredReading[]): void {
  if (deferred.length === 0) return;
  const timestamp = new Date().toISOString();
  const lines = deferred.map((d) => JSON.stringify({ ...d, timestamp })).join("\n");
  appendFileSync(resolve(root, "data", DEFERRED_QUEUE), `${lines}\n`);
}

/**
 * The terminal's rendering of an `AddOutcome` — the whole of what `add` used
 * to print inline, unchanged, now read off the value instead of interleaved
 * with the judgement that produces it. Writes nothing: by the time this runs,
 * `add` already has.
 */
export function printAddOutcome(outcome: AddOutcome): void {
  const { target, provenance, words } = outcome;

  console.log("");
  console.log(`  Adding ${words.length} word(s) against ${target}  ·  ${provenance}`);
  console.log("");

  for (const w of words) {
    console.log(`  ${w.word}`);
    printWordOutcome(w, target);
  }

  const written = words.filter((w) => w.outcome === "written");
  const deferred = words.filter((w) => w.outcome === "deferred");

  console.log("");
  if (written.length > 0) {
    console.log(`  ${written.length} reading(s) appended to data/${SUPPLEMENT}.`);
    console.log(`  Commit it, then npm run deploy — the fix applies to every Puzzle`);
    console.log(`  the word appears in, and a Session already in progress picks it up.`);
  }
  if (deferred.length > 0) {
    console.log(`  ${deferred.length} word(s) appended to data/${DEFERRED_QUEUE} for a later pass.`);
  }
  if (written.length === 0 && deferred.length === 0) {
    console.log(`  Nothing to write.`);
  }
  console.log("");
}

function printWordOutcome(w: WordOutcome, target: RhymeKey): void {
  switch (w.outcome) {
    case "refused-name":
      console.log(`    refused: a Proper Noun stays a Proper Noun, however well it rhymes.`);
      return;
    case "already-reads":
      console.log(
        `    already reads on ${target} — the reading an add would write is there, nothing to add.` +
          ` Whether it is an Answer or a Bonus Word is its wordhood and its Tier, not this.`,
      );
      for (const reading of w.readings) console.log(`      ${reading.phonemes.join(" ")}`);
      return;
    case "reads-on-another-key":
      console.log(
        `    already has a reading that does not rhyme. That is a CORRECTION, not an add:` +
          ` overriding an upstream pronunciation stays a deliberate hand-edit in` +
          ` data/supplement.dict.`,
      );
      for (const reading of w.readings) console.log(`      ${reading.phonemes.join(" ")}`);
      return;
    case "written":
      if (w.composed !== null) {
        const { head, tail, phonemes } = w.composed;
        console.log(`    composed  ${phonemes.join(" ")}`);
        console.log(
          `    from      ${head.word} (${head.phonemes.join(" ")}) + ` +
            `${tail.word} (${tail.phonemes.join(" ")}), the tail taking secondary stress`,
        );
      } else {
        console.log(`    no compound split reaches ${target} — asking the agent to author one.`);
        console.log(`    the agent proposed  ${w.phonemes.join(" ")}  — verified against ${target}.`);
      }
      return;
    case "deferred":
      console.log(`    no compound split reaches ${target} — asking the agent to author one.`);
      if (w.reason === "agent-unavailable") {
        console.log(`    the agent did not answer. Deferred.`);
      } else {
        console.log(
          `    the agent proposed  ${w.proposed!.join(" ")}, which does not reach ${target}. Deferred.`,
        );
      }
      return;
    default: {
      const exhaustive: never = w;
      throw new Error(`unreachable word outcome: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * The Rhyme Key an add is aimed at, taken from a scheduled day, or `null` when
 * the run does not cover the date.
 *
 * Split out of `targetFor` below because a date outside the run is a different
 * event to the two surfaces that ask. To a command it is the end of the run —
 * `fail` prints and exits, and there is nothing else the process was going to
 * do. To the dev server behind the web mode it is one request to refuse: the
 * editor's next act is to type a different date, and a `process.exit(1)` would
 * take the server down and the player's shell with it, which is the same trap
 * `editorDayPlugin.ts` avoids by not calling `loadSchedule`. So the lookup is
 * here, without an opinion about what a caller does when it comes back empty,
 * and each surface supplies its own.
 */
export function targetIn(schedule: Schedule, date: string): ScheduledAddTarget | null {
  const day = schedule.days.find((d) => d.date === date);
  if (day === undefined) return null;
  return {
    target: day.rhymeKey,
    provenance: `${day.date}, the ${day.seed} Puzzle`,
    seed: day.seed,
  };
}

/** The Rhyme Key an add is aimed at, for a command: a date off the run is fatal. */
export function targetFor(schedule: Schedule, date: string): ScheduledAddTarget {
  const aim = targetIn(schedule, date);
  if (aim === null) {
    fail(`No Daily Puzzle scheduled for ${date}. Pass --rhymeKey to add against a key directly.`);
  }
  return aim;
}
