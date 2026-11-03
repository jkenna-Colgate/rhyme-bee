/**
 * The trial of the Judge on Answers that only Normalisation puts on the Rhyme
 * Key (#296; ADR-0021, 2026-11-02 amendment), run once by the maintainer before
 * the No False Accepts hunt sends such Answers (#297).
 *
 *   npx tsx scripts/appendedReadingsTrial.ts [--sample N] [--yes]
 *
 * Across every scheduled day it finds the scored Answers that reach the day's
 * Rhyme Key, or a key merged into its family, only through readings
 * Normalisation appended (`src/appendedReadings.ts`), and puts each to the
 * Judge once, rhyme and wordhood apart, exactly as the hunt does
 * (`judgeHunt`). Without `--yes` it states how many words it found, on how many
 * days, and the calls that takes, and stops there: every call is on the
 * maintainer's subscription.
 *
 * Once the calls are made it asks the maintainer about a sample of `--sample`
 * words (30 by default), one from each of that many days spread across the
 * days that have any, leaving out the days the maintainer's given rulings
 * cover. The Judge's ruling is not shown until the sitting is over, so the
 * maintainer rules blind. Then it scores the Judge against the given rulings
 * and the sampled ones, prints the agreement and writes a run report to
 * `data/judge-runs/` to be committed. It writes nothing to the game's data.
 *
 * At the usage limit it stops with nothing written: the calls made so far are
 * cached, and the same command resumes after the reset.
 */

import { createInterface } from "node:readline/promises";
import { appendedOnlyAnswers } from "../src/appendedReadings.ts";
import type { Agreed } from "../src/judge.ts";
import {
  GIVEN_RULINGS,
  parseSampleRuling,
  sampleAcrossDays,
  samplePrompt,
  scoreTrial,
  type SampleRuling,
  type TrialDay,
  type TrialItem,
  type TrialPair,
} from "./judgeTrial.ts";
import { rulingList, type HuntRuling } from "../src/noFalseAccepts.ts";
import { rhymeKeyOf } from "../src/phonology.ts";
import { schwaTwinOf } from "../src/schwaTwins.ts";
import { huntCalls, judgeHunt, sessionOn, type HuntDay } from "./batchHunt.ts";
import { JUDGE_MODEL, loadIndex, readScheduleFile } from "./judgeRun.ts";
import { nextRun, today, UsageStopError, writeRunReport } from "./modelCall.ts";

const argv = process.argv.slice(2);
const confirmed = argv.includes("--yes");
const sampleAt = argv.indexOf("--sample");
const sampleSize = sampleAt === -1 ? 30 : Number(argv[sampleAt + 1]);
const known = new Set(["--yes", "--sample"]);
if (!Number.isInteger(sampleSize) || sampleSize < 0 || argv.some((a, i) => !known.has(a) && (sampleAt === -1 || i !== sampleAt + 1))) {
  console.error("usage: appendedReadingsTrial [--sample N] [--yes]");
  process.exit(2);
}

const model = JUDGE_MODEL;
const index = loadIndex();
const { raw, schedule } = readScheduleFile();

// ---- the selection -------------------------------------------------------------

const unpinned: { date: string; seedWord: string; failed: string }[] = [];
const days: TrialDay[] = schedule.days.flatMap((d) => {
  const session = sessionOn(index, d.seed, d.rhymeKey, raw.scoring);
  if ("failed" in session) {
    unpinned.push({ date: d.date, seedWord: d.seed, failed: session.failed });
    return [];
  }
  const twin = schwaTwinOf(d.rhymeKey);
  const keys = twin === null ? [d.rhymeKey] : [d.rhymeKey, twin];
  return [{ date: d.date, seedWord: d.seed, rhymeKey: d.rhymeKey, words: appendedOnlyAnswers([...session.answerScores.keys()], keys, (w) => index.readingsOf(w)) }];
});
const withWords = days.filter((d) => d.words.length > 0);
const found = withWords.reduce((t, d) => t + d.words.length, 0);

/** A given ruling the selection no longer finds is still put to the Judge, since it is scored on. */
const givenOutside = GIVEN_RULINGS.filter((g) => !days.some((d) => d.seedWord === g.seedWord && d.words.includes(g.word)));
const huntDays: HuntDay[] = days.flatMap((d) => {
  const words = [...d.words, ...givenOutside.filter((g) => g.seedWord === d.seedWord).map((g) => g.word)];
  if (!words.length) return [];
  return [{ seedWord: d.seedWord, rhymeKey: d.rhymeKey, date: d.date, answers: words.length, hunted: words.map((word) => ({ word, reasons: [], wiktionaryKeys: [] })) }];
});
const missingGiven = givenOutside.filter((g) => !days.some((d) => d.seedWord === g.seedWord));
const sample = sampleAcrossDays(days, sampleSize, new Set(GIVEN_RULINGS.map((g) => g.seedWord)));
const calls = huntCalls(huntDays);

// ---- the plan ------------------------------------------------------------------

console.error(
  `Answers on the day's Rhyme Key (or its merged keys) only through readings Normalisation appended, on the index as built:\n` +
  `  ${found} words on ${withWords.length} of ${schedule.days.length} scheduled days; none on ${days.length - withWords.length} days` +
  `${unpinned.length ? `; ${unpinned.length} days do not pin (${unpinned.map((u) => `${u.date} ${u.seedWord}`).join(", ")})` : ""}`,
);
for (const d of withWords) console.error(`  ${d.date} ${d.seedWord} /${d.rhymeKey}/ ${d.words.length}: ${d.words.join(" ")}`);
if (givenOutside.length) console.error(`  given rulings the selection no longer finds, sent anyway: ${givenOutside.map((g) => `${g.word} for ${g.seedWord}`).join(", ")}`);
if (missingGiven.length) console.error(`  given rulings on a day that does not pin, and so not sent: ${missingGiven.map((g) => `${g.word} for ${g.seedWord}`).join(", ")}`);
console.error(
  `The maintainer's rulings: ${GIVEN_RULINGS.length} given, and a sample of ${sample.length} asked after the calls, one from each of ${sample.length} days.\n` +
  `Calls, all on the maintainer's subscription, on the Judge (${model}): ${calls.rhyme} rhyme calls (8 pairs a call) and ` +
  `${calls.wordhood} wordhood calls (20 words a call), ${calls.rhyme + calls.wordhood} in all, for ${calls.sent} pairs.`,
);
if (!confirmed) {
  console.error("Nothing was called. Run again with --yes once the maintainer has agreed to the calls.");
  process.exit(0);
}

// ---- the calls -----------------------------------------------------------------

const stem = `appended-readings-trial.${model}`;
const run = nextRun(stem);
let leg: Awaited<ReturnType<typeof judgeHunt>>;
try {
  leg = await judgeHunt(huntDays, { model, run });
} catch (e) {
  if (!(e instanceof UsageStopError)) throw e;
  console.error(`\n${e.message}. Nothing was written, and the calls made so far are cached: run the same command again after the reset.`);
  process.exit(1);
}
const pairKey = (word: string, seedWord: string) => `${word} ${seedWord}`;
const rulingOf = new Map(leg.rulings.map((r) => [pairKey(r.answer.word, r.seedWord), r]));

// ---- the sitting ---------------------------------------------------------------

/** The game's readings of the word, the appended ones marked, so the maintainer sees what is in question. */
function readingLines(pair: TrialPair): string[] {
  return index.readingsOf(pair.word).map((r) => {
    const key = rhymeKeyOf(r.pronunciation);
    return `  the game reads: ${r.pronunciation.join(" ")}  /${key ?? "?"}/${r.generated ? "  (appended by Normalisation)" : ""}`;
  });
}

async function askSample(pairs: readonly TrialPair[]): Promise<SampleRuling[]> {
  if (!process.stdin.isTTY) {
    if (pairs.length) console.error("\nNo terminal to ask on, so every sampled word is skipped and only the given rulings are scored.");
    return pairs.map(() => "skip");
  }
  console.error(`\nThe sample: ${pairs.length} words, each scored by the game today. The Judge's rulings are shown once you are done.`);
  const asking = createInterface({ input: process.stdin, output: process.stderr });
  const out: SampleRuling[] = [];
  try {
    for (const [i, pair] of pairs.entries()) {
      console.error(`\n[${i + 1}/${pairs.length}] ${pair.word} for ${pair.seedWord}`);
      for (const line of [...readingLines(pair), ...samplePrompt(pair)]) console.error(`  ${line}`);
      for (;;) {
        const got = parseSampleRuling(await asking.question("  your ruling > "));
        if (got) { out.push(got); break; }
        console.error("  That does not read. Type y, n or s, then Enter.");
      }
    }
  } finally {
    asking.close();
  }
  return out;
}

const sampled = await askSample(sample);

// ---- the score -----------------------------------------------------------------

const NOT_RULED: HuntRuling["rhyme"] = { verdict: "no-ruling", reading: null, confidence: "low", why: "not sent to the Judge" };
const keyOf = (seedWord: string) => huntDays.find((d) => d.seedWord === seedWord)?.rhymeKey;
const items: TrialItem[] = [
  ...GIVEN_RULINGS.flatMap((g) => {
    const rhymeKey = keyOf(g.seedWord);
    return rhymeKey ? [{ ...g, rhymeKey, from: "given" as const, judge: rulingOf.get(pairKey(g.word, g.seedWord))?.rhyme ?? NOT_RULED }] : [];
  }),
  ...sample.map((p, i) => ({
    word: p.word, seedWord: p.seedWord, rhymeKey: p.rhymeKey, from: "sampled" as const,
    maintainer: sampled[i]!, judge: rulingOf.get(pairKey(p.word, p.seedWord))?.rhyme ?? NOT_RULED,
  })),
];
const score = scoreTrial(items);

const pct = ([a, b]: Agreed) => `${a}/${b}${b ? ` (${((100 * a) / b).toFixed(1)}%)` : ""}`;
const listed = rulingList(leg.rulings);
const tally: Record<string, number> = {};
for (const r of leg.rulings) tally[`${r.rhyme.verdict} ${r.rhyme.confidence}`] = (tally[`${r.rhyme.verdict} ${r.rhyme.confidence}`] ?? 0) + 1;
const doubts: Record<string, number> = {};
for (const l of listed) for (const d of l.doubts) doubts[d] = (doubts[d] ?? 0) + 1;

console.log(`\n## The Judge on ${leg.rulings.length} pairs (${leg.calls.rhyme} rhyme and ${leg.calls.wordhood} wordhood calls, ${leg.calls.fromCache} from the cache)`);
console.log(`rhyme rulings: ${JSON.stringify(tally)}`);
console.log(`the hunt's ruling list would hold ${listed.length} (${JSON.stringify(doubts)}) on ${new Set(listed.map((l) => l.seedWord)).size} days`);
console.log(`\n## Agreement with the maintainer: ${pct([score.agreed, score.compared])}`);
console.log(`  given ${pct(score.byFrom.given)}; sampled ${pct(score.byFrom.sampled)} (${sampled.filter((s) => s === "skip").length} skipped)`);
console.log(`  by the Judge's confidence: ${Object.entries(score.byConfidence).map(([c, a]) => `${c} ${pct(a)}`).join(", ")}`);
console.log(`  no Rhymes the hunt's list would hold: ${pct(score.falseAcceptsListed)}; Rhymes it would put on the list anyway: ${pct(score.rhymesListed)}`);
for (const m of score.misses) console.log(`  MISS ${m.word} for ${m.seedWord} [${m.from}] maintainer ${m.maintainer}, Judge ${m.judge.verdict} (${m.judge.confidence}): ${m.judge.why}`);

const date = today();
const path = writeRunReport(date, stem, run, {
  date, command: `appendedReadingsTrial ${argv.join(" ")}`.trim(), run, model, answeredBy: leg.answeredBy, calls: leg.calls,
  note:
    "A one-off trial (#296; ADR-0021, 2026-11-02 amendment): every scored Answer on a scheduled day's Rhyme Key (or its merged keys) " +
    "only through readings Normalisation appended, put to the Judge once, rhyme and wordhood apart, as the No False Accepts hunt asks. " +
    "Scored against the maintainer's given rulings and a sample asked blind. Nothing is written to the game's data.",
  selection: {
    words: found, days: withWords.length, scheduledDays: schedule.days.length, daysWithNone: days.length - withWords.length,
    unpinned, givenOutside: givenOutside.map((g) => ({ word: g.word, seedWord: g.seedWord })),
    perDay: withWords.map((d) => ({ date: d.date, seedWord: d.seedWord, rhymeKey: d.rhymeKey, words: d.words })),
  },
  rhymeRulings: tally,
  rulingList: { held: listed.length, doubts, words: listed.map((l) => ({ word: l.answer.word, seedWord: l.seedWord, doubts: l.doubts })) },
  agreement: score,
  sample: sample.map((p, i) => ({ ...p, maintainer: sampled[i] })),
  rulings: leg.rulings.map((r) => ({ word: r.answer.word, seedWord: r.seedWord, rhymeKey: r.rhymeKey, rhyme: r.rhyme, wordhood: r.wordhood ?? null })),
});
console.log(`\nreport: ${path}\nCommit it, and post the agreement and a recommendation on #296.`);
