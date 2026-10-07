/**
 * PROTOTYPE, throwaway (#231). Cuts the second held-out set, labelled by the
 * rules of #232 wherever they decide. The first set is spent: it was labelled
 * by ear under a shifting policy and its misses have been read.
 *
 *   npx tsx scripts/judge.prototype/heldout2.ts            tally only
 *   npx tsx scripts/judge.prototype/heldout2.ts --write    also write heldout-2.json and labels/heldout-2.rules.json
 *
 * Drawn from the unruled pairs in pool.json that no review batch has taken.
 * Pairs the rules put out of the question (Tier, wordhood, the unruled shape)
 * are never drawn.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pinnedEvidenceContext } from "../editorAdd.ts";
import { deserialise } from "../../src/serialise.ts";
import type { Pair } from "./pool.ts";
import { decide, substitutionBreaks, type Decision } from "./rules.ts";

const here = import.meta.dirname;
const load = <T>(p: string): T => JSON.parse(readFileSync(resolve(here, p), "utf8"));
const taken = new Set(load<Pair[]>("batch-1.json").map((p) => p.id));
const root = resolve(import.meta.dirname, "../..");
const manifest = JSON.parse(readFileSync(resolve(root, "dist-data/index.manifest.json"), "utf8"));
const index = deserialise(JSON.parse(readFileSync(resolve(root, "dist-data", manifest.index), "utf8")));
const lex = { ...pinnedEvidenceContext(), known: (w: string) => index.tierOf(w).tier === "answer" };

const pairs = load<Pair[]>("pool.json").filter((p) => !p.onFile && !taken.has(p.id));
const ruled = pairs.map((p) => ({ ...p, rule: decide(p, lex) }));
type Ruled = Pair & { rule: Decision };

const tally: Record<string, number> = {};
for (const p of ruled) { const k = `${p.rule.verdict.padEnd(8)} ${p.kind}`; tally[k] = (tally[k] ?? 0) + 1; }
console.log(`${pairs.length} unruled pairs`);
for (const [k, n] of Object.entries(tally).sort()) console.log(` ${String(n).padStart(4)}  ${k}`);
const whys: Record<string, number> = {};
for (const p of ruled) { const k = `${p.rule.verdict}: ${p.rule.why.replace(/[a-z]+ \+ [a-z]+/g, "A + B").replace(/form of [a-z]+/, "form of X")}`; whys[k] = (whys[k] ?? 0) + 1; }
for (const [k, n] of Object.entries(whys).sort((a, b) => b[1] - a[1])) console.log(` ${String(n).padStart(4)}  ${k}`);

// mulberry32, seeded apart from the first set's 231.
function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = prng(2312);
const shuffled = <T>(xs: T[]) => xs.map((x) => [rand(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);

// By what the rules said, so each of the three is large enough to state a rate for.
const QUOTA = { rhyme: 40, "no-rhyme": 90, ask: 70 } as const;
const PER_KEY_CAP = 12;
const heldout: Ruled[] = [];
for (const verdict of Object.keys(QUOTA) as (keyof typeof QUOTA)[]) {
  const perKey = new Map<string, number>();
  let got = 0;
  for (const p of shuffled(ruled.filter((x) => x.rule.verdict === verdict).sort((a, b) => a.id.localeCompare(b.id)))) {
    if (got >= QUOTA[verdict]) break;
    const n = perKey.get(p.rhymeKey) ?? 0;
    if (n >= PER_KEY_CAP) continue;
    perKey.set(p.rhymeKey, n + 1);
    heldout.push(p);
    got++;
  }
}
const count = (f: (p: Ruled) => string) => { const t: Record<string, number> = {}; for (const p of heldout) t[f(p)] = (t[f(p)] ?? 0) + 1; return t; };
console.log("held out", heldout.length, count((p) => p.rule.verdict), count((p) => p.kind), count((p) => p.source), "keys", new Set(heldout.map((p) => p.rhymeKey)).size);

const decided = heldout.filter((p) => p.rule.verdict !== "ask").map((p) => ({ word: p.word, rhymeKey: p.rhymeKey, label: p.rule.verdict }));
console.log("substitution breaks among the rule labels:", substitutionBreaks(decided));

if (process.argv.includes("--write")) {
  const out = resolve(here, "heldout-2.json");
  if (existsSync(out)) throw new Error("heldout-2.json exists; a held-out set is cut once");
  mkdirSync(resolve(here, "labels"), { recursive: true });
  writeFileSync(out, JSON.stringify(shuffled(heldout), null, 1));
  writeFileSync(resolve(here, "labels/heldout-2.rules.json"),
    JSON.stringify(Object.fromEntries(heldout.filter((p) => p.rule.verdict !== "ask").map((p) => [p.id, p.rule.verdict])), null, 1));
  console.log("wrote heldout-2.json and labels/heldout-2.rules.json");
} else {
  for (const v of ["rhyme", "ask", "no-rhyme", "out"] as const) {
    console.log(`--- ${v}, a sample`);
    for (const p of shuffled(ruled.filter((x) => x.rule.verdict === v)).slice(0, 28)) console.log(`  ${p.word} / ${p.seedWord}  [${p.kind}, ${p.source}]  ${p.rule.why}`);
  }
}
