/**
 * The Appeals step of the monthly workflow (#274, ADR-0021 amended): give each
 * new Candidate in the Appeal queue to the Judge, and land what each ruling
 * earns through the landing step (#266).
 *
 *   npm run appeals:pull
 *   npm run appeals:judge -- --limit 40
 *
 * It reads the queue `npm run appeals:pull` writes,
 * `data/supplement-candidates.jsonl`, and sends at most `--limit` Candidates,
 * oldest Appeal first: anyone can send an Appeal, and each one judged spends
 * the maintainer's plan. A Candidate is never sent twice. One already in
 * `data/judge-rulings.jsonl` or Declined is passed over, and one the limit
 * holds back is first in line next run. Each ruling lands as `judge.ts` lands
 * it. The index is not rebuilt here.
 *
 * What it judged is left in `data/monthly-run/appeals.json` (gitignored) for
 * `npm run monthly:report`, which writes the run report. Every call is on the
 * pinned model, on the maintainer's subscription, and the command prints how
 * many calls it will make before it makes them. A call that fails fails the
 * command, so the workflow marks the run failed and GitHub emails its owner.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDeclines } from "../src/declines.ts";
import { judgeQuestion } from "../src/judge.ts";
import { rulingKey } from "../src/judgeLanding.ts";
import { parseCandidates } from "../src/supplementCandidate.ts";
import {
  addWrites,
  candidatePair,
  JUDGE_MODEL,
  landJudgeLeg,
  loadIndex,
  noCalls,
  noWrites,
  pairLine,
  readRulings,
  reportRuling,
  rhymeCalls,
  runJudge,
  wordFacts,
  type JudgeLeg,
} from "./judgeRun.ts";
import { nextRun, root, today } from "./modelCall.ts";
import { MONTHLY_RUN_DIR, MONTHLY_STEM, planAppeals, type AppealsPart } from "./monthlyRun.ts";

const readIfPresent = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");

const at = process.argv.indexOf("--limit");
const limit = at === -1 ? NaN : Number(process.argv[at + 1]);
if (!Number.isInteger(limit) || limit < 0) {
  console.error("usage: appeals:judge -- --limit <n>   (the most Candidates sent to the Judge this run)");
  process.exit(2);
}

const index = loadIndex();
const model = JUDGE_MODEL;
const queue = parseCandidates(readIfPresent(resolve(root, "data/supplement-candidates.jsonl")));
const plan = planAppeals(queue, {
  question: (word, rhymeKey) => judgeQuestion(wordFacts(index, word), rhymeKey),
  seedKeys: (seedWord) => index.rhymeKeysOf(seedWord),
  rulings: readRulings(),
  declines: parseDeclines(readIfPresent(resolve(root, "data/declines.txt"))),
  limit,
});

const run = nextRun(MONTHLY_STEM(model));
const date = today();
console.error(
  `${queue.length} Appeal(s) in the queue. Judging ${plan.send.length} (limit ${limit}; ${plan.waiting.length} wait for the next run), ` +
    `run ${run} on ${model}: ${rhymeCalls(plan.send)} rhyme call(s), then the wordhood question for any that would act.`,
);

const leg: JudgeLeg = plan.send.length > 0
  ? await runJudge(plan.send, { model, run, askWordhood: true })
  : { items: [], calls: noCalls(), answeredBy: [] };
const landings = landJudgeLeg(leg, { model, date });
const recorded = new Map(landings.records.map((r) => [rulingKey(r.word, r.rhymeKey), r]));

const landed: Record<string, number> = {};
for (const r of landings.records) landed[r.landed] = (landed[r.landed] ?? 0) + 1;

const keyGone = plan.keyGone.map((c) => ({ word: c.word, seedWord: c.seedWord, rhymeKey: c.seedRhymeKey }));
for (const j of leg.items) {
  const r = recorded.get(rulingKey(j.word, j.rhymeKey));
  console.log(`${pairLine(j)}: ${r ? `${r.knew}, ${r.verdict} (${r.confidence}), landed ${r.landed}${r.heldBack ? ` (held back: ${r.heldBack})` : ""}` : "no ruling could be read, so it is sent again next run"}`);
}
for (const i of plan.waiting) console.log(`${pairLine(i)}: waits for the next run (over the limit)`);
for (const i of plan.setAside) console.log(`${pairLine(i)}: not sent (${"setAside" in i.question ? i.question.setAside : ""})`);
for (const i of plan.declined) console.log(`${pairLine(i)}: not sent (Declined by the editor)`);
for (const { item, record } of plan.ruledBefore) console.log(`${pairLine(item)}: not sent (ruled on ${record.date}, landed ${record.landed})`);
for (const c of keyGone) console.log(`${pairLine(c)}: not sent (${c.seedWord} no longer reads on that Rhyme Key)`);

const part: AppealsPart = {
  date, model, run, limit, answeredBy: leg.answeredBy, calls: leg.calls,
  candidatesJudged: landings.records.length, landed,
  writes: addWrites(noWrites(), landings),
  rulings: leg.items.map((j) => ({ ...reportRuling(j), landed: recorded.get(rulingKey(j.word, j.rhymeKey))?.landed ?? null })),
  waiting: plan.waiting.map(candidatePair),
  setAside: plan.setAside.map((i) => ({ ...candidatePair(i), why: "setAside" in i.question ? i.question.setAside : "" })),
  ruledBefore: plan.ruledBefore.map(({ item, record }) => ({ ...candidatePair(item), ruledOn: record.date, landed: record.landed })),
  declined: plan.declined.map(candidatePair),
  keyGone,
};
const dir = resolve(root, MONTHLY_RUN_DIR);
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, "appeals.json"), `${JSON.stringify(part, null, 2)}\n`);
console.log(`\nlanded: ${JSON.stringify(landed)}\nleft for the run report: ${MONTHLY_RUN_DIR}/appeals.json\nrebuild the index for the writes to take effect: npm run build:index`);
