/**
 * The Judge, from the command line (#250, #266). It rules, lands what each
 * ruling earns, and writes a run report in `data/judge-runs/` listing every
 * write.
 *
 *   npx tsx scripts/judge.ts <candidates.json>
 *   npx tsx scripts/judge.ts --score <set> [<set> ...] [--with-taken-back]
 *
 * The first form rules on a list of Candidates, a JSON array of
 * `{ "word", "seedWord", "rhymeKey"? }` (the key is needed only for a Seed Word
 * read more than one way). A Candidate is ruled on once: one already in
 * `data/judge-rulings.jsonl` is not sent again. Each ruling lands as ADR-0017's
 * table says, as a reading in `data/supplement.dict`, an Unconfirmed Rhyme in
 * `data/unconfirmed-rhymes.txt`, or nothing, and every ruling is recorded. The
 * index is not rebuilt: run `npm run build:index` after.
 *
 * `--score` rules on every pair of the named label sets in `data/judge-labels/`
 * and states the Judge's agreement with each labeller in them, on their blind
 * verdicts unless `--with-taken-back` is given. The pairs nobody ruled are
 * labelled by the rules of #232 as they stand now. It asks no wordhood question,
 * except on a wordhood set, and writes nothing to the game's data.
 *
 * Every call is on the pinned model, on the maintainer's subscription. The
 * command prints how many calls it will make before it makes them.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { judgeQuestion, parseWordhoodReply, WORDHOOD_BATCH, wordhoodPrompt, type WordhoodRuling } from "../src/judge.ts";
import { labellersOf, parseLabelSet, scoreRhymes, scoreWordhood, type LabelSet, type RhymeScore, type RuledPair } from "../src/judgeLabels.ts";
import { parseDeclines } from "../src/declines.ts";
import { planJudging } from "../src/judgeLanding.ts";
import { decide } from "../src/judgeRules.ts";
import {
  JUDGE_MODEL,
  landJudgeLeg,
  loadIndex,
  readRulings,
  reportRuling,
  rhymeCalls,
  rulesLexicon,
  runJudge,
  scheduledKey,
  seedKeyNow,
  wordFacts,
  type JudgeItem,
} from "./judgeRun.ts";
import { callModel, inParallel, nextRun, root, today, writeRunReport } from "./modelCall.ts";

const argv = process.argv.slice(2);
const index = loadIndex();
const model = JUDGE_MODEL;

const pct = (a: number, b: number) => `${a}/${b}${b ? ` (${((100 * a) / b).toFixed(1)}%)` : ""}`;

if (argv[0] === "--score") await score(argv.slice(1).filter((a) => !a.startsWith("--")), argv.includes("--with-taken-back"));
else if (argv[0] && !argv[0].startsWith("--")) await rule(argv[0]);
else {
  console.error("usage: judge <candidates.json> | judge --score <set> [<set> ...] [--with-taken-back]");
  process.exit(2);
}

async function rule(file: string) {
  const list = JSON.parse(readFileSync(resolve(file), "utf8")) as { word: string; seedWord: string; rhymeKey?: string }[];
  const candidates: JudgeItem[] = list.map((c) => {
    const rhymeKey = index.pinSeed(c.seedWord, c.rhymeKey ?? scheduledKey(c.seedWord)).rhymeKey;
    return { word: c.word.toLowerCase(), seedWord: c.seedWord, rhymeKey, question: judgeQuestion(wordFacts(index, c.word), rhymeKey) };
  });
  const { send, ruledBefore, declined } = planJudging(candidates, readRulings(), parseDeclines(readFileSync(resolve(root, "data/declines.txt"), "utf8")));
  const stem = `judge.${file.replace(/^.*[\\/]/, "").replace(/\.json$/, "")}.${model}`;
  const run = nextRun(stem);
  const date = today();
  console.error(`judging ${send.length} Candidates (${ruledBefore.length} ruled on before and ${declined.length} Declined, neither sent), run ${run}: ${rhymeCalls(send)} rhyme calls, then the wordhood question for any that would act`);
  const leg = await runJudge(send, { model, run, askWordhood: true });
  const landings = landJudgeLeg(leg, { model, date });
  const recorded = new Map(landings.records.map((r) => [`${r.word} ${r.rhymeKey}`, r]));

  const landed: Record<string, number> = {};
  for (const r of landings.records) landed[r.landed] = (landed[r.landed] ?? 0) + 1;
  for (const j of leg.items) {
    const r = recorded.get(`${j.word} ${j.rhymeKey}`);
    const said = "setAside" in j.question ? `not sent (${j.question.setAside})`
      : !r ? `${j.question.ask}, no ruling could be read, so it is sent again next run`
      : `${r.knew}, ${r.verdict} (${r.confidence}), landed ${r.landed}${r.heldBack ? ` (held back: ${r.heldBack})` : ""}`;
    console.log(`${j.word} for ${j.seedWord} /${j.rhymeKey}/: ${said}`);
  }
  for (const c of declined) console.log(`${c.word} for ${c.seedWord} /${c.rhymeKey}/: not sent (Declined by the editor)`);
  for (const { candidate: c, record: r } of ruledBefore) console.log(`${c.word} for ${c.seedWord} /${c.rhymeKey}/: not sent (ruled on ${r.date}, landed ${r.landed})`);

  const path = writeRunReport(date, stem, run, {
    date, command: `judge ${file}`, run, model, answeredBy: leg.answeredBy, calls: leg.calls,
    candidatesJudged: landings.records.length, landed,
    writes: {
      readings: landings.readings.map((r) => ({ word: r.word, reading: r.phonemes.join(" ") })),
      unconfirmedRhymes: landings.unconfirmedRhymes,
      suggestedDemotions: landings.records.filter((r) => r.landed === "suggested-demotion").map((r) => ({ word: r.word, rhymeKey: r.rhymeKey, reason: r.wordhood!.verdict })),
    },
    note: "Every write is listed under writes, and every ruling is recorded in data/judge-rulings.jsonl. The index is not rebuilt (#266).",
    rulings: leg.items.map((j) => ({ ...reportRuling(j), landed: recorded.get(`${j.word} ${j.rhymeKey}`)?.landed ?? null })),
    declined: declined.map((c) => ({ word: c.word, seedWord: c.seedWord, rhymeKey: c.rhymeKey })),
    ruledBefore: ruledBefore.map(({ candidate: c, record: r }) => ({ word: c.word, seedWord: c.seedWord, rhymeKey: c.rhymeKey, ruledOn: r.date, landed: r.landed })),
  });
  console.log(`\nlanded: ${JSON.stringify(landed)}\nreport: ${path}\nrebuild the index for the writes to take effect: npm run build:index`);
}

function readSet(name: string): LabelSet {
  return parseLabelSet(JSON.parse(readFileSync(resolve(root, "data/judge-labels", `${name}.json`), "utf8")));
}

async function score(names: string[], withTakenBack: boolean) {
  if (!names.length) throw new Error("name at least one label set");
  const sets = names.map(readSet);
  const opts = { blindOnly: !withTakenBack };
  const stem = `judge-score.${names.join("+")}.${model}`;
  const run = nextRun(stem);
  const lex = rulesLexicon(index);

  const plan = sets.map((set) => {
    if (set.question === "wordhood") {
      const words = [...new Set(set.pairs.map((p) => p.word))].sort();
      return { set, words, calls: Math.ceil(words.length / WORDHOOD_BATCH) };
    }
    const items = set.pairs.map((p) => {
      const rhymeKey = seedKeyNow(index, p.seedWord, p.seedReading, p.rhymeKeyWhenCut);
      return { word: p.word, seedWord: p.seedWord, rhymeKey, question: judgeQuestion(wordFacts(index, p.word), rhymeKey), pair: p };
    });
    return { set, items, calls: Math.ceil(items.length / 8) };
  });
  console.error(`scoring ${names.join(", ")} on ${model}, run ${run}: ${plan.reduce((t, p) => t + p.calls, 0)} calls`);

  const reportSets: unknown[] = [];
  const allCalls = { rhyme: 0, wordhood: 0, fromCache: 0 };
  const answeredBy = new Set<string>();
  for (const p of plan) {
    const { set } = p;
    const flag = set.tuning ? " (a tuning set: a score on it flatters the Judge)" : "";
    console.log(`\n## ${set.set}${flag}: ${set.pairs.length} pairs, labelled by ${set.labelledBy.join(", ")} on ${set.labelledOn}, under ${set.rules.join(", ")}; ${opts.blindOnly ? "blind verdicts only" : "verdicts taken back after seeing the Judge included"}`);

    if ("words" in p && p.words) {
      const ruled: WordhoodRuling[] = [];
      const chunks = Array.from({ length: p.calls }, (_, i) => p.words.slice(i * WORDHOOD_BATCH, (i + 1) * WORDHOOD_BATCH));
      await inParallel(chunks.map((chunk) => async () => {
        const reply = await callModel(model, wordhoodPrompt(chunk), run);
        allCalls.wordhood++;
        if (reply.cached) allCalls.fromCache++;
        reply.answeredBy.forEach((m) => answeredBy.add(m));
        ruled.push(...parseWordhoodReply(reply.text, chunk));
      }));
      process.stderr.write("\n");
      const scores = labellersOf(set).map((l) => scoreWordhood(set.pairs, ruled, l, opts));
      for (const s of scores) {
        console.log(`${s.labeller}: names and non-words held back ${pct(s.caught.agreed, s.caught.scored)}; words left alone ${pct(s.leftAlone.agreed, s.leftAlone.scored)}`);
        for (const m of s.misses) console.log(`  MISS ${m.word}: label ${m.label}, Judge ${m.ruling.verdict} (${m.ruling.confidence}): ${m.ruling.why}`);
      }
      reportSets.push({ set: set.set, question: set.question, tuning: set.tuning, scores, rulings: ruled });
      continue;
    }

    const items = p.items!;
    const leg = await runJudge(items, { model, run, askEvery: true, askWordhood: false });
    allCalls.rhyme += leg.calls.rhyme;
    allCalls.fromCache += leg.calls.fromCache;
    leg.answeredBy.forEach((m) => answeredBy.add(m));
    const ruledPairs: RuledPair[] = leg.items.map((j, i) => ({
      word: j.word, seedWord: j.seedWord, rhymeKey: j.rhymeKey, question: j.question,
      rule: decide({ word: j.word, rhymeKey: j.rhymeKey, wiktionary: items[i]!.pair.wiktionary }, lex),
      ruling: j.ruling, verdicts: items[i]!.pair.verdicts,
    }));
    const tally: Record<string, number> = {};
    for (const r of ruledPairs) tally[r.ruling.verdict] = (tally[r.ruling.verdict] ?? 0) + 1;
    console.log(`verdicts: ${JSON.stringify(tally)}`);
    const scores = labellersOf(set).map((l) => scoreRhymes(ruledPairs, l, opts));
    for (const s of scores) printRhymeScore(s);
    reportSets.push({
      set: set.set, question: set.question, tuning: set.tuning, blindOnly: opts.blindOnly,
      scores: scores.map(({ misses, ...rest }) => ({ ...rest, misses: misses.map((m) => ({ ...m, ruling: { ...m.ruling } })) })),
      rulings: leg.items.map((j, i) => ({ ...reportRuling(j), rule: ruledPairs[i]!.rule.verdict })),
    });
  }

  const path = writeRunReport(today(), stem, run, {
    date: today(), command: `judge --score ${names.join(" ")}${withTakenBack ? " --with-taken-back" : ""}`, run, model,
    answeredBy: [...answeredBy].sort(), calls: allCalls,
    candidatesJudged: plan.reduce((t, p) => t + ("items" in p && p.items ? p.items.length : p.words!.length), 0),
    note: "A score against label sets. Rulings are reported where they would land, and nothing is written to the game (#250).",
    sets: reportSets,
  });
  console.log(`\nreport: ${path}`);
}

function printRhymeScore(s: RhymeScore) {
  console.log(`${s.labeller} and the rules: ${pct(s.agreed, s.scored)} (a Rhyme counts only when its reading reaches the key; ${pct(s.ungated.agreed, s.ungated.scored)} without that check)`);
  console.log(`  labelled by ${s.labeller}: ${pct(s.fromLabeller.agreed, s.fromLabeller.scored)}; by the rules: ${pct(s.fromRules.agreed, s.fromRules.scored)}`);
  console.log(`  by what the game knows: ${Object.entries(s.byCase).map(([k, t]) => `${k} ${t.agreed}/${t.scored}`).join(", ")}`);
  console.log(`  by confidence: ${Object.entries(s.byConfidence).map(([k, t]) => `${k} ${t!.agreed}/${t!.scored}`).join(", ")}`);
  console.log(`  label -> Judge: ${JSON.stringify(s.confusion)}`);
  console.log(`  would land, and wrong on the labels: ${Object.entries(s.wouldLand).map(([k, w]) => `${k} ${w!.wrong} wrong of ${w!.written}`).join("; ") || "nothing"}`);
  for (const m of s.misses) console.log(`  MISS ${m.word} for ${m.seedWord} [by ${m.from === "rules" ? "the rules" : s.labeller}] label ${m.label}, Judge ${m.ruling.verdict} (${m.ruling.confidence})${m.ruling.verdict === "rhyme" && !m.reachesKey ? ", reading misses the key" : ""}: ${m.ruling.why}`);
}
