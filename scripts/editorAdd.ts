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
 * The outcome types this returns are declared in `web/src/editor/addOutcome.ts`
 * and imported back, the direction every other editor route already uses: the
 * browser renders them and cannot import this module, which opens files and
 * shells out to an agent (#171).
 *
 * The judgement (`resolveAddOutcome`, `gatherEvidence`, `composeReading`,
 * `verifyReading`) is tested, and so are `add`'s two writes, over a temp dir
 * with the agent stubbed — which is what `AddDeps` is for. What stays untested
 * is the agent *invocation*: nothing covers the real `claude -p` spawn or its
 * argv, and nothing here can without running it. The reading of what comes back
 * is a gate on the core rather than a neighbour of it, so it lives in
 * `editorReading.ts` and is tested there.
 */

import { spawn } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normaliseWord, parseCmudict } from "../src/cmudict.ts";
import type { Pronunciation, RhymeKey } from "../src/phonology.ts";
import { parseWordList } from "../src/pipeline.ts";
import type { Schedule } from "../src/schedule.ts";
import { applySupplement } from "../src/supplement.ts";
import {
  evidenceContextFrom,
  gatherEvidence,
  verifyReading,
  type EvidenceContext,
  type WordEvidence,
  type WordReading,
} from "../src/supplementEvidence.ts";
import { killTree } from "../web/killTree.ts";
import type {
  AddOutcome,
  AddTarget,
  DeferredOutcome,
  ScheduledAddTarget,
  WordOutcome,
  WrittenOutcome,
} from "../web/src/editor/addOutcome.ts";
import { parseReading } from "./editorReading.ts";
import { fail, root } from "./editorShell.ts";

/**
 * How an add asks an agent to author a reading — real in `add`, stubbed in
 * tests.
 *
 * It takes the **evidence** rather than a word and a target, though it needs
 * only those two to write today's prompt. The caller gathers the evidence
 * immediately before calling, so passing the whole record costs nothing and
 * carries strictly more: the direct readings, the inflectional relatives,
 * wordhood and name status are all there for the case that wants them. Each
 * further fact an adapter comes to need is then a fact it reads off an argument
 * it already has, rather than another parameter on a seam every adapter and
 * every stub would have to widen together.
 */
export type AgentAuthor = (evidence: WordEvidence) => Promise<Pronunciation | null>;

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
 * the whole of what makes it testable. `add` below supplies the real context
 * and hands on whatever author its own caller named, which is nothing on both
 * live paths — so `authorWithAgent` is what they get.
 */
export async function resolveAddOutcome(
  words: readonly string[],
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

    const authored = await authorReading(evidence);
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
 * What `add` will take from a caller instead of reaching for itself. Every
 * field is optional and every default is the real thing, so the two live
 * surfaces — `web/editorAddPlugin.ts` and the CLI — pass nothing and get the
 * real agent and the real `data/` files, exactly as before.
 *
 * The seam is here rather than one level down at `resolveAddOutcome` because
 * that is where it was unreachable: `AgentAuthor` was injectable at the
 * judgement, but no live path calls the judgement — both go through `add`,
 * which always supplied the real `claude -p` spawn. A seam only the tests can
 * see is a seam only the tests can see.
 *
 * The two paths are what make the seam worth having. With the author stubbed
 * and the paths left real, `add` is testable right up to the point it writes,
 * and then writes to the repository's own `data/`. Injecting them is what lets
 * a temp dir stand in — the technique `web/__tests__/tierOverrideFile.test.ts`
 * already uses — so the two appends can be asserted end to end rather than
 * inferred from the returned value.
 */
export interface AddDeps {
  /** How a word no split resolves gets a reading. `authorWithAgent`, live. */
  author?: AgentAuthor;
  /** Where accepted readings land. `data/supplement.dict`, live. */
  supplementPath?: string;
  /** Where misses land. `data/deferred-readings.jsonl`, live. */
  deferredPath?: string;
  /**
   * Which words in this batch a **player** asked for: the ones raised from the
   * Candidate Queue rather than typed by the editor (#178). Each one's reading
   * carries that into `data/supplement.dict` as a comment above it, so a future
   * reader of the supplement knows the word is there because somebody Appealed
   * it — which is a different fact from an editor spotting a gap, and the only
   * place it can be recorded is the file the reading lands in.
   *
   * It is here, among the things `add` takes from a caller instead of reaching
   * for itself, because that is exactly what it is: where a word came from is
   * knowledge the surface that collected it has and this function cannot
   * recover. The default is the real thing for the CLI, which has no queue to
   * raise a word from — nobody Appealed anything, and no comment is written.
   *
   * It changes **no judgement**. `resolveAddOutcome` never sees it: a word a
   * player asked for is composed, authored and verified exactly as any other
   * word is (ADR-0014), and provenance that moved the bar would be a second
   * standard for readings.
   */
  appealed?: readonly string[];
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
 *
 * `deps` defaults to nothing at all, so a caller that wants the real add keeps
 * writing `add(words, aim)`. See `AddDeps` for why the three are injectable.
 */
export async function add(
  words: readonly string[],
  aim: AddTarget,
  deps: AddDeps = {},
): Promise<AddOutcome> {
  const outcome = await resolveAddOutcome(words, aim, pinnedEvidenceContext(), deps.author);
  appendToSupplement(
    writtenReadings(outcome, deps.appealed ?? []),
    deps.supplementPath ?? resolve(root, "data", SUPPLEMENT),
  );
  appendToDeferredQueue(deferredReadings(outcome), deps.deferredPath ?? resolve(root, "data", DEFERRED_QUEUE));
  return outcome;
}

/**
 * One accepted reading, and the comment that goes above it — `null` for the
 * ordinary add, which carries none.
 *
 * `WordReading` is the shape `verifyReading` and the supplement's own parser
 * deal in, and it is deliberately not widened with a note: a comment is a fact
 * about *why this line was written*, which no reader of a reading has any use
 * for. So the note travels beside the reading, as far as the append and no
 * further.
 */
interface SupplementEntry {
  reading: WordReading;
  note: string | null;
}

/**
 * The readings to write, each with its provenance comment when a player asked
 * for it.
 *
 * The words are matched by normalised spelling, which is the spelling
 * `gatherEvidence` reports back on the outcome and the one the endpoint's parser
 * has already applied — so a word raised from a Candidate is recognised as the
 * same word here rather than by the string the caller happened to hold.
 */
function writtenReadings(outcome: AddOutcome, appealed: readonly string[]): SupplementEntry[] {
  const asked = new Set(appealed.map(normaliseWord));
  return outcome.words
    .filter((w): w is WrittenOutcome => w.outcome === "written")
    .map((w) => ({
      reading: { word: w.word, phonemes: w.phonemes },
      note: asked.has(w.word) ? provenanceNote(w.word, outcome.provenance) : null,
    }));
}

/**
 * What a reading raised from a Candidate says about itself, as a whole-line
 * comment above the entry.
 *
 * A whole line rather than a trailing gloss, because the supplement's parser
 * only strips lines that *start* with `#` — `parseCmudict` would read a trailing
 * comment's words as phonemes and the entry would be nonsense (`src/supplement.ts`).
 * The section header this sits under already says the reading was verified
 * against the day's Rhyme Key; what it cannot say, and what this adds, is that a
 * player is the reason the word was looked at.
 */
function provenanceNote(word: string, provenance: string): string {
  return `# ${word}: a player Appealed this word — raised from the Candidate Queue (${provenance}).`;
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
 *
 * Exported for the Candidate Queue's readout endpoint
 * (`web/editorCandidatesPlugin.ts`), which needs the *same* stack for the same
 * reason: a Candidate's target Rhyme Key comes off the schedule or off a Seed
 * the built index pinned, and judging it under a context assembled any other way
 * would report a disagreement about the accent as a disagreement about the
 * rhyme — which is precisely the five cot–caught Candidates all over again. The
 * two paths call one function rather than reading the same four files twice.
 */
export function pinnedEvidenceContext(): EvidenceContext {
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
 *
 * The prompt is written here, from the evidence, rather than handed in: what an
 * agent has to be told is a fact about *this* adapter's agent and not about the
 * add path, and a caller that composed it would have to know both. That is what
 * #179 narrowed the seam for, and #180 is the case it was narrowed *against*: a
 * correction reads `evidence.direct` off an argument this adapter already holds,
 * with no third parameter and nothing for the two other adapters to widen.
 *
 * Exported because it is the live adapter for two callers now — `add` above and
 * `proposeCorrection` (`scripts/editorCorrection.ts`) — and a second copy of the
 * spawn, the timeout and the kill would be a second thing to get right about a
 * subprocess nothing can test.
 */
export function authorWithAgent(evidence: WordEvidence): Promise<Pronunciation | null> {
  const { word, target } = evidence;
  const prompt = [
    `Write the General American CMUdict/ARPAbet pronunciation of the English word "${word}".`,
    `It must rhyme on the Rhyme Key ${target} — that is, the phonemes from its last`,
    `stressed vowel to the end of the word must be exactly: ${target}.`,
    "",
    "Use ARPAbet phonemes with stress digits on vowels (0 unstressed, 1 primary,",
    "2 secondary), separated by single spaces. A compound's final element usually",
    "takes secondary rather than primary stress.",
    // Only when there is one. A word the pinned sources do not read at all is an
    // add and this paragraph would be a lie; a word they *do* read is a
    // correction, and the reading being corrected is the single most useful
    // thing an author can be shown — it is usually right about the phonemes and
    // wrong only about which vowel carries the stress (ADR-0009).
    ...correctionContext(evidence),
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
 * The paragraph an agent is shown when it is being asked to **correct** a
 * reading rather than to author one from nothing: the readings the engine holds
 * today, each with the Rhyme Key it computes to.
 *
 * Empty for a word with no reading, which is the add path's every agent call and
 * was the whole of this prompt before #180. Written as a list because a word can
 * hold more than one reading and the one being corrected is not always the
 * first — and because saying "the current reading is X" of a word with two would
 * be false in a way that invites the agent to reproduce X.
 */
function correctionContext({ direct, target }: WordEvidence): string[] {
  if (direct.length === 0) return [];
  return [
    "",
    "The pinned sources already read this word, and the reading is wrong — it is",
    `not on ${target}. What they currently say, with the Rhyme Key each computes to:`,
    ...direct.map((r) => `  ${r.phonemes.join(" ")}  →  ${r.key ?? "no stressed vowel"}`),
    "Correct it. Usually the phonemes are right and the stress is on the wrong vowel.",
  ];
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
 * for a word the *editor* named — the reason for that add is constant, and a
 * line restating it every time carries no information (ADR-0014).
 *
 * A word raised from the Candidate Queue is the exception, and it is an
 * exception on exactly that test: "a player asked for this" is not constant
 * across the section, so a line saying it carries information no other line
 * does (#178).
 */
const EDITOR_SECTION =
  "# --- Adds by the Editor's Pass: composed from a compound split and verified\n" +
  "# against the day's Rhyme Key before being written here (ADR-0014). ---";

function appendToSupplement(entries: SupplementEntry[], path: string): void {
  if (entries.length === 0) return;
  const existing = readFileSync(path, "utf8");
  const section = existing.includes(EDITOR_SECTION) ? "" : `\n${EDITOR_SECTION}\n`;
  const lines = entries
    .map(({ reading, note }) => {
      const entry = `${reading.word} ${reading.phonemes.join(" ")}`;
      return note === null ? entry : `${note}\n${entry}`;
    })
    .join("\n");
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
function appendToDeferredQueue(deferred: DeferredReading[], path: string): void {
  if (deferred.length === 0) return;
  const timestamp = new Date().toISOString();
  const lines = deferred.map((d) => JSON.stringify({ ...d, timestamp })).join("\n");
  appendFileSync(path, `${lines}\n`);
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
