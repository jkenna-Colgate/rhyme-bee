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
 * An imperative shell carrying no game logic of its own, and left untested as
 * the rest of the pass is — the judgements it prints come from the tested core
 * (`gatherEvidence`, `composeReading`, `verifyReading`). The agent invocation is
 * untested by the same precedent; the reading of what comes back is a gate on
 * the core rather than a neighbour of it, so it lives in `editorReading.ts` and
 * is tested there.
 */

import { spawn, type ChildProcess } from "node:child_process";
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
  type EvidenceContext,
  type WordReading,
} from "../src/supplementEvidence.ts";
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
}

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
 * before it is written (ADR-0014). Anything that still fails is appended to the
 * deferred queue, so a miss is recorded rather than rediscovered next time.
 *
 * The words are independent of one another: every one is judged against the
 * same snapshot of the evidence, taken before the first of them (see
 * `evidenceContext`), so their order carries no meaning and no word can be a
 * part of another's compound split within one invocation.
 */
export async function add(words: string[], aim: AddTarget): Promise<void> {
  const { target, provenance } = aim;
  const ctx = evidenceContext();
  const accepted: WordReading[] = [];
  const deferred: DeferredReading[] = [];

  console.log("");
  console.log(`  Adding ${words.length} word(s) against ${target}  ·  ${provenance}`);
  console.log("");

  for (const supplied of words) {
    const evidence = gatherEvidence(supplied, target, ctx);
    const word = evidence.word;
    console.log(`  ${word}`);

    // A name stays a name, however well it rhymes: the space of names is
    // unbounded and has no defensible edge. Refused rather than deferred —
    // deferring says "later", and this is never.
    if (evidence.isName) {
      console.log(`    refused: a Proper Noun stays a Proper Noun, however well it rhymes.`);
      continue;
    }

    if (evidence.direct.length > 0) {
      const verdict = evidence.rhymesDirectly
        ? `already reads on ${target} — it is in the game already, nothing to add.`
        : `already has a reading that does not rhyme. That is a CORRECTION, not an add:` +
          ` overriding an upstream pronunciation stays a deliberate hand-edit in` +
          ` data/supplement.dict.`;
      console.log(`    ${verdict}`);
      for (const reading of evidence.direct) console.log(`      ${reading.phonemes.join(" ")}`);
      continue;
    }

    if (evidence.composed !== null) {
      const { head, tail, phonemes } = evidence.composed;
      console.log(`    composed  ${phonemes.join(" ")}`);
      console.log(
        `    from      ${head.word} (${head.phonemes.join(" ")}) + ` +
          `${tail.word} (${tail.phonemes.join(" ")}), the tail taking secondary stress`,
      );
      accepted.push({ word, phonemes });
      continue;
    }

    console.log(`    no compound split reaches ${target} — asking the agent to author one.`);
    const authored = await authorWithAgent(word, target);
    if (authored === null) {
      deferred.push({ word, rhymeKey: target, reason: "agent-unavailable" });
      console.log(`    the agent did not answer. Deferred.`);
    } else if (verifyReading(authored, target)) {
      // The same predicate, applied to a reading this program did not compose.
      // Delegating authorship does not lower the bar.
      console.log(`    the agent proposed  ${authored.join(" ")}  — verified against ${target}.`);
      accepted.push({ word, phonemes: authored });
    } else {
      deferred.push({ word, rhymeKey: target, reason: "agent-reading-failed-verification" });
      console.log(`    the agent proposed  ${authored.join(" ")}, which does not reach ${target}. Deferred.`);
    }
  }

  appendToSupplement(accepted);
  appendToDeferredQueue(deferred);
  printAddSummary(accepted, deferred);
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

/**
 * End the abandoned CLI, so it does not outlive the command that asked it a
 * question. `shell: true` is what lets `claude` be found on Windows, where it
 * is a `.cmd` shim — but it also means the child this program holds is the
 * shell, and killing that alone would orphan the CLI under it. `taskkill /t`
 * takes the tree. Elsewhere the shell execs the command in place, so the signal
 * reaches the CLI directly.
 */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"]).on("error", () => {});
  } else {
    child.kill();
  }
}

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

function printAddSummary(
  accepted: WordReading[],
  deferred: DeferredReading[],
): void {
  console.log("");
  if (accepted.length > 0) {
    console.log(`  ${accepted.length} reading(s) appended to data/${SUPPLEMENT}.`);
    console.log(`  Commit it, then npm run deploy — the fix applies to every Puzzle`);
    console.log(`  the word appears in, and a Session already in progress picks it up.`);
  }
  if (deferred.length > 0) {
    console.log(`  ${deferred.length} word(s) appended to data/${DEFERRED_QUEUE} for a later pass.`);
  }
  if (accepted.length === 0 && deferred.length === 0) {
    console.log(`  Nothing to write.`);
  }
  console.log("");
}

/** The Rhyme Key an add is aimed at, taken from a scheduled day. */
export function targetFor(schedule: Schedule, date: string): AddTarget {
  const day = schedule.days.find((d) => d.date === date);
  if (day === undefined) {
    fail(`No Daily Puzzle scheduled for ${date}. Pass --rhymeKey to add against a key directly.`);
  }
  return { target: day.rhymeKey, provenance: `${day.date}, the ${day.seed} Puzzle` };
}
