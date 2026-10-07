/**
 * PROTOTYPE, throwaway (#231). Cuts tuning batch N: the pairs the judge's
 * environment is changed against, so the held-out set is never tuned on.
 *
 *   npx tsx scripts/judge.prototype/batch.ts 2            tally only
 *   npx tsx scripts/judge.prototype/batch.ts 2 --write    also write batch-2.json and labels/batch-2.rules.json
 *
 * Drawn from the unruled pairs in pool.json that no earlier batch and no
 * held-out set took. Each pair carries the rules' own decision, as a held-out
 * pair does, and the pairs the rules put out of the question are never drawn.
 * Every pair the rules leave open is taken, since those are the ones a judge is
 * for and there are few of them; the maintainer labels them on the page
 * labeller.ts writes.
 *
 * batch-1.json was cut by this file's first version (cbbcd2e), by kind and
 * before the rules existed, so its pairs carry no decision.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pinnedEvidenceContext } from "../editorAdd.ts";
import { deserialise } from "../../src/serialise.ts";
import type { Pair } from "./pool.ts";
import { decide, substitutionBreaks, type Decision } from "./rules.ts";

const here = import.meta.dirname;
const root = resolve(here, "../..");
const n = Number(process.argv[2]);
if (!(n >= 2)) throw new Error("usage: batch.ts <N, 2 or more> [--write]");
const out = resolve(here, `batch-${n}.json`);
if (existsSync(out)) throw new Error(`batch-${n}.json exists; a batch is cut once`);
const load = <T>(p: string): T => JSON.parse(readFileSync(resolve(here, p), "utf8"));

const taken = new Set<string>();
for (const f of readdirSync(here)) {
  if (/^(batch-\d+|heldout-\d+)\.json$/.test(f)) for (const p of load<Pair[]>(f)) taken.add(p.id);
}
const manifest = JSON.parse(readFileSync(resolve(root, "dist-data/index.manifest.json"), "utf8"));
const index = deserialise(JSON.parse(readFileSync(resolve(root, "dist-data", manifest.index), "utf8")));
const lex = { ...pinnedEvidenceContext(), known: (w: string) => index.tierOf(w).tier === "answer" };

type Ruled = Pair & { rule: Decision };
const left: Ruled[] = load<Pair[]>("pool.json").filter((p) => !p.onFile && !taken.has(p.id)).map((p) => ({ ...p, rule: decide(p, lex) }));

// By what the rules said. The refusals get the larger share: every miss on the 130 rule-labelled
// pairs of heldout-2 was a refusal the judge called a Rhyme, and none was a Rhyme it refused.
const QUOTA = { rhyme: 30, "no-rhyme": 49, ask: Infinity } as const;
const PER_KEY_CAP = 6;
// Deterministic spread: order by a hash of the id salted with the batch number.
const hash = (s: string) => { let h = n; for (const c of s) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0; return h; };
const batch: Ruled[] = [];
for (const verdict of Object.keys(QUOTA) as (keyof typeof QUOTA)[]) {
  const perKey = new Map<string, number>();
  let got = 0;
  for (const p of left.filter((x) => x.rule.verdict === verdict).sort((a, b) => hash(a.id) - hash(b.id) || a.id.localeCompare(b.id))) {
    if (got >= QUOTA[verdict]) break;
    const k = perKey.get(p.rhymeKey) ?? 0;
    if (QUOTA[verdict] !== Infinity && k >= PER_KEY_CAP) continue;
    perKey.set(p.rhymeKey, k + 1);
    batch.push(p);
    got++;
  }
}

const count = (ps: Ruled[], f: (p: Ruled) => string) => { const t: Record<string, number> = {}; for (const p of ps) t[f(p)] = (t[f(p)] ?? 0) + 1; return t; };
console.log(`${left.length} pairs left`, count(left, (p) => p.rule.verdict));
console.log(`batch ${n}: ${batch.length} pairs`, count(batch, (p) => p.rule.verdict), count(batch, (p) => p.kind), count(batch, (p) => p.source), "keys", new Set(batch.map((p) => p.rhymeKey)).size);
const decided = batch.filter((p) => p.rule.verdict !== "ask");
console.log("substitution breaks among the rule labels:", substitutionBreaks(decided.map((p) => ({ word: p.word, rhymeKey: p.rhymeKey, label: p.rule.verdict }))));

if (process.argv.includes("--write")) {
  mkdirSync(resolve(here, "labels"), { recursive: true });
  writeFileSync(out, JSON.stringify(batch.sort((a, b) => hash(a.id) - hash(b.id) || a.id.localeCompare(b.id)), null, 1));
  writeFileSync(resolve(here, `labels/batch-${n}.rules.json`), JSON.stringify(Object.fromEntries(decided.map((p) => [p.id, p.rule.verdict])), null, 1));
  console.log(`wrote batch-${n}.json and labels/batch-${n}.rules.json`);
}
