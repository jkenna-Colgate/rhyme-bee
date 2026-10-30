/**
 * The Synthetic Player, from the command line (#250): plays Seed Words, hands
 * the Candidates to the Judge, and reports. It writes nothing to the game's
 * data: the only file it writes is its run report in `data/judge-runs/`.
 *
 *   npx tsx scripts/synthetic-player.ts <seed> [<seed> ...] [--model <id>] [--max-judge-calls N]
 *
 * One player call per Seed Word, on `--model` (an exact id, Sonnet by default,
 * per #227), then the Judge on its pinned model: one rhyme call per eight
 * Candidates it is asked about, and one wordhood call per twenty words whose
 * ruling would act. If the Judge's rhyme leg would take more than
 * `--max-judge-calls` (30 by default), the run stops before making it.
 *
 * A Seed Word's Trust count is the Candidates the Judge rules a Rhyme, with a
 * reading that reaches the key (#225).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { judgeQuestion } from "../src/judge.ts";
import { startSession, type ScoringConfig } from "../src/session.ts";
import { parsePlayerReply, playerPrompt, playWords } from "../src/syntheticPlayer.ts";
import { DEFAULT_PLAYER_MODEL, JUDGE_MODEL, landingCounts, loadIndex, reportRuling, rhymeCalls, runJudge, scheduledKey, wordFacts, type JudgeItem } from "./judgeRun.ts";
import { callModel, exactModelId, inParallel, nextRun, root, today, writeRunReport } from "./modelCall.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? undefined : argv.splice(i, 2)[1];
};
const playerModel = exactModelId(flag("model") ?? DEFAULT_PLAYER_MODEL);
const maxJudgeCalls = Number(flag("max-judge-calls") ?? 30);
const seeds = argv.filter((a) => !a.startsWith("--"));
if (!seeds.length) {
  console.error("usage: synthetic-player <seed> [<seed> ...] [--model <id>] [--max-judge-calls N]");
  process.exit(2);
}

const index = loadIndex();
const schedule = JSON.parse(readFileSync(resolve(root, "data/schedule.json"), "utf8")) as { scoring: ScoringConfig };
const stem = `synthetic-player.${seeds.join("+")}.${playerModel}`;
const run = nextRun(stem);
console.error(`playing ${seeds.join(", ")} on ${playerModel}, run ${run}: ${seeds.length} player calls`);

const contexts = seeds.map((seed) => startSession(index, index.pinSeed(seed, scheduledKey(seed)), schedule.scoring));
const replies = await inParallel(contexts.map((ctx) => () => callModel(playerModel, playerPrompt(ctx.seed.word, ctx.puzzle.seedRespelling), run)));
process.stderr.write("\n");

const plays = contexts.map((ctx, i) => ({ ctx, words: parsePlayerReply(replies[i]!.text), play: playWords(ctx, parsePlayerReply(replies[i]!.text)) }));
const items: JudgeItem[] = plays.flatMap(({ ctx, play }) =>
  play.candidates.map((c) => {
    const word = c.word.trim().toLowerCase();
    return { word, seedWord: ctx.seed.word, rhymeKey: ctx.seed.rhymeKey, question: judgeQuestion(wordFacts(index, word), ctx.seed.rhymeKey) };
  }));

const calls = rhymeCalls(items);
console.error(`${items.length} Candidates, ${items.filter((i) => "ask" in i.question).length} for the Judge: ${calls} rhyme calls, then the wordhood question for any that would act`);
if (calls > maxJudgeCalls) {
  console.error(`stopping: the Judge's rhyme leg would take ${calls} calls, over --max-judge-calls ${maxJudgeCalls}. Nothing was judged and no report was written.`);
  process.exit(1);
}
const leg = await runJudge(items, { model: JUDGE_MODEL, run, askWordhood: true });

const seedsPlayed = plays.map(({ ctx, words, play }, i) => {
  const mine = leg.items.filter((j) => j.seedWord === ctx.seed.word);
  const trust = mine.filter((j) => j.classification?.reachesKey);
  const tally: Record<string, number> = {};
  for (const s of play.submissions) {
    const k = s.verdict.outcome === "rejected" ? s.verdict.reason : s.verdict.outcome;
    tally[k] = (tally[k] ?? 0) + 1;
  }
  const found = new Set(play.submissions.filter((s) => s.verdict.outcome === "answer").map((s) => s.word.toLowerCase()));
  return {
    seedWord: ctx.seed.word,
    rhymeKey: ctx.seed.rhymeKey,
    answers: ctx.puzzle.answers.length,
    maxScore: play.maxScore,
    wordsTyped: words.length,
    verdicts: tally,
    score: play.score,
    share: Number(play.share.toFixed(4)),
    rank: play.rank,
    candidates: play.candidates.length,
    sentToJudge: mine.filter((j) => j.classification).length,
    trust: trust.length,
    trustWords: trust.map((j) => j.word),
    answersNeverProduced: ctx.puzzle.answers.filter((a) => !found.has(a.word)).sort((a, b) => (b.knownness ?? 0) - (a.knownness ?? 0)).map((a) => a.word),
    playerAnsweredBy: replies[i]!.answeredBy,
    words,
  };
});

for (const s of seedsPlayed) {
  console.log(`\n## ${s.seedWord} /${s.rhymeKey}/: ${s.wordsTyped} words, ${(100 * s.share).toFixed(0)}% of the maximum (${s.rank}), ${JSON.stringify(s.verdicts)}`);
  console.log(`  Trust: the Judge rules ${s.trust} of ${s.sentToJudge} Candidates sent a Rhyme${s.trust ? `: ${s.trustWords.join(", ")}` : ""}`);
}
for (const j of leg.items) {
  const r = reportRuling(j);
  console.log(`  ${j.word} for ${j.seedWord}: ${"setAside" in r ? `not sent (${r.setAside})` : `${r.knew}, ${r.verdict} (${r.confidence})${r.verdict === "rhyme" && !r.reachesKey ? ", reading misses the key" : ""}, would land as ${r.wouldLand}`}`);
}

const path = writeRunReport(today(), stem, run, {
  date: today(),
  command: `synthetic-player ${seeds.join(" ")} --model ${playerModel}`,
  run,
  model: JUDGE_MODEL,
  playerModel,
  answeredBy: [...new Set([...leg.answeredBy, ...replies.flatMap((r) => r.answeredBy)])].sort(),
  calls: { player: replies.length, ...leg.calls, fromCache: leg.calls.fromCache + replies.filter((r) => r.cached).length },
  candidatesJudged: leg.items.filter((j) => j.classification).length,
  wouldLand: landingCounts(leg.items),
  note: "Rulings are reported where they would land, and nothing is written to the game (#250). Trust is the Candidates the Judge rules a Rhyme with a reading that reaches the key.",
  seedsPlayed,
  rulings: leg.items.map(reportRuling),
});
console.log(`\nreport: ${path}`);
