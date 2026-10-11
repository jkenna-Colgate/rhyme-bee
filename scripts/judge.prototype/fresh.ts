/**
 * PROTOTYPE, throwaway (#238). Cuts the fresh set: pairs on Rhyme Keys the
 * judge's instructions were never tuned near. pool.json is used up, so the
 * pairs come from Synthetic Player runs on scheduled Seed Words whose Rhyme
 * Key is in no pair of pool.json or heldout.json.
 *
 *   npx tsx scripts/judge.prototype/fresh.ts seeds 100    print the Seed Words to run the Synthetic Player on
 *   npx tsx scripts/judge.prototype/fresh.ts              tally what those runs give
 *   npx tsx scripts/judge.prototype/fresh.ts --write      also write fresh-1.json and labels/fresh-1.rules.json
 *
 * Labelled by the rules of #232 wherever they decide, as heldout-2 was. The
 * rest go to the maintainer on the label page before any ruling is read.
 * Unlike heldout-2 the cut is weighted toward pairs the engine has no reading
 * for; fresh-1.strata.json holds the real mix.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { bareSound, isVowel, isVowelSound, rhymeKeyOf, type Pronunciation, type RhymeKey } from "../../src/phonology.ts";
import { respell } from "../../src/respelling.ts";
import { deserialise, type SerialisedIndex } from "../../src/serialise.ts";
import { gatherEvidence } from "../../src/supplementEvidence.ts";
import { pinnedEvidenceContext } from "../editorAdd.ts";
import type { Evidence, Kind, Pair } from "./pool.ts";
import { decide, substitutionBreaks, type Decision } from "./rules.ts";

const here = import.meta.dirname;
const root = process.env.RHYME_BEE_ROOT ?? resolve(here, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const load = <T>(p: string): T => JSON.parse(readFileSync(resolve(here, p), "utf8"));

const manifest = JSON.parse(read("dist-data/index.manifest.json"));
const index = deserialise(JSON.parse(read(`dist-data/${manifest.index}`)) as SerialisedIndex);
const schedule = JSON.parse(read("data/schedule.json")) as { days: { seed: string; rhymeKey: RhymeKey }[] };
const ctx = pinnedEvidenceContext();

const seenKeys = new Set([...load<Pair[]>("pool.json"), ...load<Pair[]>("heldout.json")].map((p) => p.rhymeKey));

// mulberry32, seeded apart from 231 and 2312.
function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = prng(238);
const shuffled = <T>(xs: T[]) => xs.map((x) => [rand(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);

/** Scheduled Seed Words on a Rhyme Key the pool never touched, that still pin. Same order on every run. */
const freshSeeds = shuffled(
  schedule.days
    .filter((d) => !seenKeys.has(d.rhymeKey))
    .filter((d) => { try { index.pinSeed(d.seed, d.rhymeKey); return true; } catch { return false; } })
    .sort((a, b) => a.seed.localeCompare(b.seed)),
);

if (process.argv[2] === "seeds") {
  console.log(freshSeeds.slice(0, Number(process.argv[3] ?? 100)).map((d) => d.seed).join(" "));
  process.exit(0);
}

// ---- the pairs, built as pool.ts builds its Synthetic Player pairs ----------

const sounds = (p: Pronunciation) => p.map(bareSound).join(" ");
function isWeak(reading: Pronunciation, key: RhymeKey): boolean {
  if (key.split(" ").filter(isVowelSound).length !== 1) return false;
  if (rhymeKeyOf(reading) === key) return false;
  let last = -1;
  reading.forEach((p, i) => { if (isVowel(p)) last = i; });
  return last >= 0 && sounds(reading.slice(last)) === key;
}
function evidenceOf(word: string, key: RhymeKey): Evidence {
  const ev = gatherEvidence(word, key, ctx);
  return {
    isWord: ev.isWord,
    isName: ev.isName,
    readings: ev.direct.map((r) => ({ phonemes: r.phonemes.join(" "), key: r.key, respelling: respell(r.phonemes) })),
    relatives: ev.relatives.map((r) => ({ word: r.word, readings: r.readings.map((x) => x.phonemes.join(" ")), rhymes: r.rhymes })),
    composed: ev.composed
      ? { phonemes: ev.composed.phonemes.join(" "), head: ev.composed.head.word, tail: ev.composed.tail.word }
      : null,
  };
}
function kindOf(ev: Evidence, key: RhymeKey): Kind | null {
  if (ev.readings.some((r) => r.key === key)) return ev.isWord ? null : "no-wordhood";
  if (ev.readings.length === 0) return "no-reading";
  return ev.readings.some((r) => isWeak(r.phonemes.split(" "), key)) ? "stress" : "wrong-reading";
}

const runDir = resolve(root, ".scratch/synthetic-player");
const pairs: Pair[] = [];
let seedsRun = 0;
for (const d of freshSeeds) {
  const file = resolve(runDir, `${d.seed}.sonnet.0.json`);
  if (!existsSync(file)) continue;
  seedsRun++;
  const seed = index.pinSeed(d.seed, d.rhymeKey);
  const sr = (ctx.pronunciations.get(seed.word) ?? []).find((p) => rhymeKeyOf(p) === seed.rhymeKey) ?? null;
  for (const word of new Set((JSON.parse(readFileSync(file, "utf8")) as { words: string[] }).words)) {
    if (word === seed.word || !/^[a-z]+$/.test(word)) continue;
    const verdict = index.adjudicate(seed, word);
    if (verdict.outcome !== "rejected" || verdict.reason === "is-the-seed-word" || verdict.reason === "malformed") continue;
    const evidence = evidenceOf(word, seed.rhymeKey);
    const kind = kindOf(evidence, seed.rhymeKey);
    if (kind === null) continue;
    pairs.push({
      id: `${word}|${seed.rhymeKey}`, word, seedWord: seed.word, rhymeKey: seed.rhymeKey,
      seedReading: sr?.join(" ") ?? null, seedRespelling: sr ? respell(sr) : null,
      kind, source: "synthetic", producedBy: 1, evidence,
    });
  }
}

type Ruled = Pair & { rule: Decision };
const lex = { ...ctx, known: (w: string) => index.tierOf(w).tier === "answer" };
const ruled: Ruled[] = pairs.sort((a, b) => a.id.localeCompare(b.id)).map((p) => ({ ...p, rule: decide(p, lex) }));

const count = (ps: Ruled[], f: (p: Ruled) => string) => { const t: Record<string, number> = {}; for (const p of ps) t[f(p)] = (t[f(p)] ?? 0) + 1; return t; };
console.log(`${seedsRun} Seed Words run, ${ruled.length} pairs the game did not accept, on ${new Set(ruled.map((p) => p.rhymeKey)).size} Rhyme Keys`);
console.log(" by the rules:", count(ruled, (p) => p.rule.verdict));
console.log(" by kind:     ", count(ruled, (p) => `${p.kind}/${p.rule.verdict}`));

// Cut by slice and by what the rules said. The safe slice is what #238 asks about, so pairs the engine has no
// reading for are over-drawn, the non-rhymes most of all: a wrong accept can only happen on one of those.
// strata records how many of each the Synthetic Player really produced, to scale a rate back to the real mix.
const sliceOf = (p: Ruled) => (p.kind === "no-reading" ? "no-reading" : "has-reading");
const QUOTA: Record<string, number> = {
  "no-reading/no-rhyme": 50, "no-reading/ask": 55, "no-reading/rhyme": 30,
  "has-reading/ask": 15, "has-reading/rhyme": 15, "has-reading/no-rhyme": 35,
};
const PER_KEY_CAP = 6;
const stratum = (p: Ruled) => `${sliceOf(p)}/${p.rule.verdict}`;
const strata = count(ruled.filter((p) => p.rule.verdict !== "out"), stratum);
const fresh: Ruled[] = [];
for (const [name, quota] of Object.entries(QUOTA)) {
  const perKey = new Map<string, number>();
  let got = 0;
  for (const p of shuffled(ruled.filter((x) => stratum(x) === name))) {
    if (got >= quota) break;
    const n = perKey.get(p.rhymeKey) ?? 0;
    if (n >= PER_KEY_CAP) continue;
    perKey.set(p.rhymeKey, n + 1);
    fresh.push(p);
    got++;
  }
}
console.log(" strata, every pair:", strata);
console.log(" strata, drawn:     ", count(fresh, stratum));
console.log("fresh set", fresh.length, count(fresh, (p) => p.rule.verdict), count(fresh, (p) => p.kind), "keys", new Set(fresh.map((p) => p.rhymeKey)).size);
console.log("substitution breaks among the rule labels:",
  substitutionBreaks(fresh.filter((p) => p.rule.verdict !== "ask").map((p) => ({ word: p.word, rhymeKey: p.rhymeKey, label: p.rule.verdict }))));

if (process.argv.includes("--write")) {
  const out = resolve(here, "fresh-1.json");
  if (existsSync(out)) throw new Error("fresh-1.json exists; a fresh set is cut once");
  writeFileSync(out, JSON.stringify(shuffled(fresh), null, 1));
  writeFileSync(resolve(here, "labels/fresh-1.rules.json"),
    JSON.stringify(Object.fromEntries(fresh.filter((p) => p.rule.verdict !== "ask").map((p) => [p.id, p.rule.verdict])), null, 1));
  writeFileSync(resolve(here, "fresh-1.strata.json"), JSON.stringify({ seedsRun, every: strata, drawn: count(fresh, stratum) }, null, 1));
  console.log("wrote fresh-1.json, fresh-1.strata.json and labels/fresh-1.rules.json");
}
