/**
 * The No False Accepts half of a Batch, from the command line (#268): the hunt,
 * the Judge's two questions, and the ruling list the maintainer settles in the
 * sitting. The rules are `src/noFalseAccepts.ts`; this file reads the extract,
 * calls the model, asks the maintainer and writes what they decide.
 *
 * The same sitting puts the rhymes the Judge ruled in the looks and left
 * undecided (#293), and the words the looks wrote in that have no knownness,
 * to Tier (#294), so one ruling list holds all three kinds of item.
 *
 * Every write goes through a path the Editor's Pass already uses: a correction
 * or a keep through `applyCorrection` (`data/supplement.dict`, replacing the
 * readings the game holds with the one corrected or the several kept), and a
 * confirmed rhyme the same way as a join beside them; a Demotion through
 * `appendDemotion` (`data/demotions.txt`); a Decline through `appendDecline`
 * (`data/declines.txt`); a Tier verdict through `appendTierOverride`
 * (`data/tier-overrides.csv`). There is no fifth.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { rhymeBatches, WORDHOOD_BATCH, type RhymeRuling, type TierAnswer } from "../src/judge.ts";
import {
  huntAnswers,
  noFalseAcceptsResult,
  type HuntedAnswer,
  type HuntRuling,
  type ListedAnswer,
  type NoFalseAcceptsResult,
} from "../src/noFalseAccepts.ts";
import {
  parseDecision,
  parseTier,
  parseUndecided,
  rulingPrompt,
  shownReadings,
  tierPrompt,
  undecidedPrompt,
  type Decision,
  type RulingItem,
} from "../src/rulingList.ts";
import type { Pronunciation, RhymeKey } from "../src/phonology.ts";
import type { RhymeIndex } from "../src/rhymeIndex.ts";
import type { Schedule } from "../src/schedule.ts";
import { seedWordCheckLines } from "../src/seedWord.ts";
import type { TierVerdict } from "../src/tierOverride.ts";
import { startSession, type PuzzleContext, type ScoringConfig } from "../src/session.ts";
import { ipaReadings, parseWiktionaryExtract, wiktionaryReadings, type WiktionaryExtract } from "../src/wiktionary.ts";
import { appendDecline, DECLINES_PATH } from "../web/declinesFile.ts";
import { appendDemotion } from "../web/demotionFile.ts";
import { appendTierOverride } from "../web/tierOverrideFile.ts";
import { pinnedEvidenceContext } from "./editorAdd.ts";
import { applyCorrection, type CorrectionAsk, type CorrectionSource } from "./editorCorrection.ts";
import { askBoth, type JudgeCalls } from "./judgeRun.ts";
import { root } from "./modelCall.ts";
import { checkLocalSources, WIKTIONARY_SOURCE } from "./sourceMirror.ts";

const dataDir = resolve(root, "data");

/**
 * The pinned extract, or why there is none: missing, or not the one
 * `data/sources.sha256` pins. A Batch stops on the reason before it calls
 * anything. CI never fetches the extract, so a clone that has only run
 * `npm run sources:fetch` lacks it until it is asked for by name.
 */
export function loadWiktionary(): WiktionaryExtract | { refused: string } {
  const faults = checkLocalSources(dataDir, [WIKTIONARY_SOURCE]);
  const problem = faults[0]?.problem;
  if (problem) {
    const why = { missing: "is missing", mismatch: "does not match its committed checksum", unpinned: "has no line in data/sources.sha256" }[problem];
    const fix = problem === "unpinned"
      ? `Build it with scripts/extract-wiktionary.ts and pin it:\n  npm run sources:upload -- ${WIKTIONARY_SOURCE}`
      : `Bring the pinned one from the mirror (the plain fetch leaves it out):\n  npm run sources:fetch -- ${WIKTIONARY_SOURCE}`;
    return { refused: `data/${WIKTIONARY_SOURCE} ${why}, so the No False Accepts hunt has no Wiktionary readings to compare. Nothing was called.\n${fix}` };
  }
  return parseWiktionaryExtract(readFileSync(resolve(dataDir, WIKTIONARY_SOURCE), "utf8"));
}

/** The Session a Seed Word starts on its Rhyme Key, or what the index said when it would not pin. */
export function sessionOn(index: RhymeIndex, seedWord: string, rhymeKey: RhymeKey, scoring: ScoringConfig): PuzzleContext | { failed: string } {
  try {
    return startSession(index, index.pinSeed(seedWord, rhymeKey), scoring);
  } catch (e) {
    return { failed: e instanceof Error ? e.message : String(e) };
  }
}

/** One Seed Word's hunt: its scored Answers and the ones sent to the Judge. */
export interface HuntDay {
  seedWord: string;
  rhymeKey: RhymeKey;
  date: string | null;
  answers: number;
  hunted: HuntedAnswer[];
}

/** The hunt over the Seed Words that pin, on the index as it stands. Calls nothing. */
export function planHunt(
  index: RhymeIndex,
  seeds: readonly { seedWord: string; rhymeKey: RhymeKey; date: string | null }[],
  scoring: ScoringConfig,
  extract: WiktionaryExtract,
): HuntDay[] {
  const facts = { wiktionaryReadings: (w: string) => wiktionaryReadings(extract, w), isName: (w: string) => index.isName(w) };
  return seeds.flatMap((s) => {
    const session = sessionOn(index, s.seedWord, s.rhymeKey, scoring);
    if ("failed" in session) return [];
    const answers = [...session.answerScores.keys()];
    return [{ ...s, answers: answers.length, hunted: huntAnswers(answers, s.rhymeKey, facts) }];
  });
}

/** The calls the Judge's two questions take for a hunt, before any is made. */
export function huntCalls(days: readonly HuntDay[]): { sent: number; rhyme: number; wordhood: number } {
  const pairs = days.flatMap((d) => d.hunted.map((h) => ({ word: h.word, seedWord: d.seedWord, rhymeKey: d.rhymeKey })));
  const words = new Set(pairs.map((p) => p.word)).size;
  return { sent: pairs.length, rhyme: rhymeBatches(pairs).length, wordhood: Math.ceil(words / WORDHOOD_BATCH) };
}

export interface HuntLeg {
  rulings: HuntRuling[];
  calls: JudgeCalls;
  answeredBy: string[];
}

const NO_RULING: RhymeRuling = { verdict: "no-ruling", reading: null, confidence: "low", why: "no reply" };

/** Ask the Judge both questions of every hunted Answer: the rhyme prompt as it was measured, and wordhood apart from it. */
export async function judgeHunt(days: readonly HuntDay[], opts: { model: string; run: number }): Promise<HuntLeg> {
  const pairs = days.flatMap((d) => d.hunted.map((answer) => ({ word: answer.word, seedWord: d.seedWord, rhymeKey: d.rhymeKey, answer })));
  const { rhyme, wordhood, calls, answeredBy } = await askBoth(pairs, { ...opts, label: "hunt" });
  const rulings: HuntRuling[] = pairs.map((p) => {
    const w = wordhood.get(p.word);
    return { seedWord: p.seedWord, rhymeKey: p.rhymeKey, answer: p.answer, rhyme: rhyme.get(p) ?? NO_RULING, ...(w ? { wordhood: w } : {}) };
  });
  return { rulings, calls, answeredBy };
}

/** What the maintainer decided on one item of the ruling list, and what was written for it. */
export interface Settled {
  item: RulingItem;
  decision: Decision;
  wrote: string | null;
}

/** The hunted Answers settled, each with its listing, which is what the gate reads. */
export function settledHunted(settled: readonly Settled[]): { listed: ListedAnswer; decision: Decision; wrote: string | null }[] {
  return settled.flatMap((s) => (s.item.kind === "hunted" ? [{ listed: s.item.listed, decision: s.decision, wrote: s.wrote }] : []));
}

/** Wiktionary's readings of a word, as ARPAbet before Normalisation, which the build applies. */
function wiktionaryOffered(extract: WiktionaryExtract, word: string): Pronunciation[] {
  return (extract.get(word) ?? []).flatMap(ipaReadings);
}

/** Rebuild the Rhyme Index, as a Batch does after each look that lands a write. */
export function rebuild(): { ok: true } | { ok: false; error: string } {
  const built = spawnSync("npx", ["tsx", "scripts/build-index.ts"], { cwd: root, shell: true, encoding: "utf8" });
  return built.status === 0 ? { ok: true } : { ok: false, error: built.stderr };
}

const TIER_OVERRIDES_PATH = resolve(dataDir, "tier-overrides.csv");

/**
 * The Tier verdict each ruling writes. An Answer is `answer-common`: the word
 * is Tiered because a player would think of it (Retrieval), and with no
 * knownness there is no measure that would make it rare.
 */
const BATCH_TIER_VERDICT = { answer: "answer-common", bonus: "bonus" } as const satisfies Record<TierAnswer, TierVerdict>;

type SittingContext = { index: () => RhymeIndex; extract: WiktionaryExtract; schedule: Schedule; today: string; loadIndex: () => RhymeIndex };

/** The item's word and the Rhyme Key it is ruled on. */
const itemPair = (item: RulingItem): { word: string; rhymeKey: RhymeKey } =>
  item.kind === "hunted" ? { word: item.listed.answer.word, rhymeKey: item.listed.rhymeKey }
  : item.kind === "undecided" ? item.rhyme
  : item.untiered;

/**
 * What the maintainer is shown for one item before the prompt, and the parser
 * that reads their answer. Each kind of item has its own prompt and parser.
 */
function presentItem(item: RulingItem, index: RhymeIndex, extract: WiktionaryExtract): { lines: string[]; parse: (input: string) => Decision | null } {
  if (item.kind === "tier") {
    const { untiered, judge } = item;
    return {
      lines: [
        `${untiered.word} for ${untiered.seedWord} /${untiered.rhymeKey}/: written in by this Batch, with no knownness`,
        ...index.readingsOf(untiered.word).map((r) => `  the game reads: ${r.pronunciation.join(" ")}`),
        ...tierPrompt(untiered, judge).map((line) => `  ${line}`),
      ],
      parse: (input) => parseTier(input, judge),
    };
  }
  if (item.kind === "undecided") {
    const { rhyme } = item;
    return {
      lines: [
        `${rhyme.word} for ${rhyme.seedWord} /${rhyme.rhymeKey}/: a rhyme the Judge left undecided`,
        ...index.readingsOf(rhyme.word).map((r) => `  the game reads: ${r.pronunciation.join(" ")}`),
        ...undecidedPrompt(rhyme).map((line) => `  ${line}`),
      ],
      parse: (input) => parseUndecided(input, rhyme),
    };
  }
  const listed = item.listed;
  const word = listed.answer.word;
  const shown = shownReadings(index.readingsOf(word), wiktionaryOffered(extract, word));
  return {
    lines: [
      `${word} for ${listed.seedWord} /${listed.rhymeKey}/: ${listed.doubts.join(", ")}`,
      `  Judge, rhyme: ${listed.rhyme.verdict} (${listed.rhyme.confidence}) ${listed.rhyme.why}`,
      ...(listed.wordhood ? [`  Judge, wordhood: ${listed.wordhood.verdict} (${listed.wordhood.confidence}) ${listed.wordhood.why}`] : []),
      `  sent for: ${listed.answer.reasons.join(", ")}`,
      ...(extract.get(word) ?? []).map((ipa) => `  Wiktionary (IPA): ${ipa}`),
      ...rulingPrompt(shown).map((line) => `  ${line}`),
    ],
    parse: (input) => parseDecision(input, shown),
  };
}

/**
 * Put the ruling list to the maintainer, one item at a time, and write each
 * ruling as it is made. It is called after the Batch's last model call, so a
 * usage stop never lands mid-sitting. With no terminal to ask, the list is
 * printed and every item is left unruled: a hunted Answer then fails the day's
 * gate, and a rhyme the Judge left undecided or a word to Tier is listed as
 * skipped.
 */
export async function settleRulingList(items: readonly RulingItem[], ctx: SittingContext): Promise<Settled[]> {
  const settled: Settled[] = [];
  const asking = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stderr }) : null;
  const count = (kind: RulingItem["kind"]) => items.filter((i) => i.kind === kind).length;
  if (items.length) {
    console.error(
      `\nThe ruling list: ${count("hunted")} scored Answers the Judge doubts at high confidence, each scored until you rule; ` +
      `${count("undecided")} rhymes the Judge ruled and left undecided, each landing nothing until you rule; ` +
      `and ${count("tier")} words this Batch wrote in with no knownness, each a Bonus Word until you Tier it.`,
    );
  }
  if (!asking && items.length) console.error("No terminal to ask on, so every one is left unruled.");
  // Reloaded after each reading written, so a word listed twice shows what it holds now.
  let index = ctx.index();
  const correctionDeps = (source: CorrectionSource) => ({
    context: pinnedEvidenceContext, schedule: () => ctx.schedule, today: () => ctx.today,
    openIndex: ctx.loadIndex, rebuild: async () => rebuild(), source,
  });
  try {
    for (const [i, item] of items.entries()) {
      const { word, rhymeKey } = itemPair(item);
      const { lines, parse } = presentItem(item, index, ctx.extract);
      console.error(`\n[${i + 1}/${items.length}] ${lines[0]}`);
      for (const line of lines.slice(1)) console.error(line);
      let decision: Decision = { kind: "unruled" };
      while (asking) {
        const got = parse(await asking.question("  your ruling > "));
        if (got) { decision = got; break; }
        console.error("  That does not read, and nothing was written. Type one of the commands above, then Enter.");
      }
      let wrote: string | null = null;
      // A correction writes one reading and a keep the several kept, both replacing every reading
      // the word had; a confirm writes one beside them.
      const replacing = decision.kind === "correction" ? [decision.reading] : decision.kind === "keep" ? decision.readings : [];
      const correction: CorrectionAsk | null = replacing.length
        ? { word, target: rhymeKey, phonemes: replacing.at(-1)!, kept: replacing.slice(0, -1), mode: "replace" }
        : decision.kind === "confirm" ? { word, target: rhymeKey, phonemes: decision.reading, mode: "join" } : null;
      if (correction) {
        const result = await applyCorrection(correction, correctionDeps(item.kind === "hunted" ? "batch" : "batch-undecided"));
        wrote = `data/supplement.dict: ${result.written.map((r) => `${word} ${r.join(" ")}`).join("; ")}${result.rebuilt.ok ? "" : " (the rebuild failed)"}`;
        if (result.rebuilt.ok) index = ctx.loadIndex();
        // A reading given to a scheduled Seed Word runs the Seed Word test (#264), as it does in the Editor's Pass.
        for (const line of seedWordCheckLines(result.seedWords)) console.error(`  ${line}`);
      } else if (decision.kind === "demotion") {
        appendDemotion(resolve(dataDir, "demotions.txt"), { word, reason: decision.reason });
        wrote = `data/demotions.txt: ${word} ${decision.reason}`;
      } else if (decision.kind === "decline") {
        appendDecline(DECLINES_PATH, { word, rhymeKey });
        wrote = `data/declines.txt: ${word} ${rhymeKey}`;
      } else if (decision.kind === "tier" && item.kind === "tier") {
        // Written as the Editor's Pass writes a Tier verdict: no measured value (the word has none), unlocked.
        const verdict = BATCH_TIER_VERDICT[decision.tier];
        appendTierOverride(TIER_OVERRIDES_PATH, {
          word, verdict, measured: null, decided: new Date().toISOString(),
          note: `Batch ${ctx.today}: written in on /${rhymeKey}/ for ${item.untiered.seedWord}`,
        });
        wrote = `data/tier-overrides.csv: ${word} ${verdict}`;
      }
      if (wrote) console.error(`  wrote ${wrote}`);
      settled.push({ item, decision, wrote });
    }
  } finally {
    asking?.close();
  }
  return settled;
}

/** The gate on each Seed Word, read off the index rebuilt with the rulings. */
export function huntResults(
  days: readonly HuntDay[],
  settled: readonly Settled[],
  index: RhymeIndex,
  scoring: ScoringConfig,
): Map<string, NoFalseAcceptsResult> {
  const out = new Map<string, NoFalseAcceptsResult>();
  const hunted = settledHunted(settled);
  for (const d of days) {
    const mine = hunted.filter((s) => s.listed.seedWord === d.seedWord);
    const session = sessionOn(index, d.seedWord, d.rhymeKey, scoring);
    const scored: ReadonlySet<string> = new Set("failed" in session ? [] : session.answerScores.keys());
    out.set(d.seedWord, noFalseAcceptsResult(
      mine.map((s) => s.listed.answer.word),
      new Map(mine.map((s) => [s.listed.answer.word, s.decision])),
      (w) => scored.has(w),
    ));
  }
  return out;
}
