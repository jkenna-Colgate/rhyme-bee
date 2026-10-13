/**
 * PROTOTYPE, throwaway (#238). States the judge's margin from repeat runs: how
 * often a ruling that would be written with nobody reviewing it is wrong.
 *
 *   npx tsx scripts/judge.prototype/margin.ts <set> <run> [<run> ...]
 *
 * Reads rulings/<set>.bare.rules-2[.run-N].sonnet.json, one per run, and the
 * labels judge.ts scores against. Calls nothing.
 *
 * The safe slice is a ruling that would write a reading and score the word:
 * the engine has no reading, the judge rules "rhyme" at high confidence, and
 * the reading it gives reaches the Rhyme Key (the gate). A wrong accept is one
 * of those on a pair labelled "no-rhyme".
 *
 * Labels come from three places and the third is kept apart: the rules, the
 * maintainer, and labels/<set>.dictionary.json, which holds Merriam-Webster's
 * reading of the pairs the maintainer left out. Where <set>.strata.json exists
 * the cut over-drew some strata, so the safe-slice rate is also given at the
 * real mix.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Pair } from "./pool.ts";

const here = import.meta.dirname;
const [set, ...runArgs] = process.argv.slice(2);
const runs = runArgs.map(Number);
if (!set || !runs.length) throw new Error("usage: margin.ts <set> <run> [<run> ...]");

interface Ruling { verdict: string; reading: string | null; confidence: string; why: string; verified?: boolean }
type Label = "rhyme" | "no-rhyme";
const load = <T>(p: string): T => JSON.parse(readFileSync(resolve(here, p), "utf8"));
const labelsIn = (f: string): Record<string, string> => (existsSync(resolve(here, "labels", f)) ? load(`labels/${f}`) : {});
const isLabel = (l: string | undefined): l is Label => l === "rhyme" || l === "no-rhyme";

/** Scored on no set: the dictionary reads `tern` as `terns`, so the Seed Word on both pairs is wrong (#240). */
const DROPPED = new Set(["unlearns|ER N Z", "sojourns|ER N Z"]);
type Cut = Pair & { rule: { verdict: string } };
const pairs = load<Cut[]>(`${set}.json`).filter((p) => p.rule.verdict !== "out" && !DROPPED.has(p.id));
const truth = new Map<string, { label: Label; from: "rules" | "maintainer" }>();
for (const [id, l] of Object.entries(labelsIn(`${set}.rules.json`))) if (isLabel(l)) truth.set(id, { label: l, from: "rules" });
for (const [id, l] of Object.entries(labelsIn(`${set}.labels.json`))) if (isLabel(l)) truth.set(id, { label: l, from: "maintainer" });
// A second look (recheck.ts) replaces the label it was taken on. Where the maintainer left the pair out the second
// time, a label of their own is withdrawn, and so is a rules label the judge disputes; the dictionary may supply one.
const was = existsSync(resolve(here, `${set}-recheck.was.json`)) ? load<Record<string, { disputed: boolean }>>(`${set}-recheck.was.json`) : {};
let relabelled = 0, withdrawn = 0;
for (const [id, l] of Object.entries(labelsIn(`${set}-recheck.labels.json`))) {
  const old = truth.get(id);
  if (isLabel(l)) { if (old?.label !== l) relabelled++; truth.set(id, { label: l, from: "maintainer" }); }
  else if (l === "out" && (old?.from === "maintainer" || was[id]?.disputed)) { truth.delete(id); withdrawn++; }
}
// Rulings the maintainer took back in conversation, having seen the judge's side. Not blind, so the count is printed.
let takenBack = 0;
for (const [id, { label: l }] of Object.entries(labelsIn(`${set}.takenback.json`) as unknown as Record<string, { label: string }>)) if (isLabel(l)) { truth.set(id, { label: l, from: "maintainer" }); takenBack++; }
/** Kept out of `truth`, so no figure mixes a dictionary label with the maintainer's unless it says so. */
const dictionary = new Map<string, Label>();
for (const [id, { label: l }] of Object.entries(labelsIn(`${set}.dictionary.json`) as unknown as Record<string, { label: string }>)) if (isLabel(l) && !truth.has(id)) dictionary.set(id, l);
const rulings = runs.map((n) => load<Record<string, Ruling>>(`rulings/${set}.bare.rules-2${n > 1 ? `.run-${n}` : ""}.sonnet.json`));

const N = runs.length;
const of = (p: Pair) => rulings.map((r) => r[p.id]!);
/** A "rhyme" whose reading reaches the key. Anything else writes nothing. */
const gatedRhyme = (r: Ruling) => r.verdict === "rhyme" && r.verified !== false;
const lands = (r: Ruling) => gatedRhyme(r) && r.confidence === "high";
const label = (p: Pair) => truth.get(p.id)?.label ?? "none";
const name = (p: Pair) => `${p.word} for ${p.seedWord}`;
const marks = (p: Pair) => of(p).map((r) => (r.verdict === "rhyme" ? (r.verified === false ? "u" : r.confidence[0]!.toUpperCase()) : "-")).join("");
const pct = (a: number, b: number) => (b ? `${a}/${b} (${((100 * a) / b).toFixed(1)}%)` : "0/0");
/** The largest rate 95% of the time when none of n were wrong (the rule of three, exactly). */
const upper = (n: number) => (n ? `${(100 * (1 - 0.05 ** (1 / n))).toFixed(1)}%` : "n/a");

console.log(`# ${set}: ${pairs.length} pairs, ${pairs.filter((p) => truth.has(p.id)).length} with a label${dictionary.size ? ` and ${pairs.filter((p) => dictionary.has(p.id)).length} more from the dictionary` : ""}, runs ${runs.join(", ")}`);

if (relabelled || withdrawn) console.log(`  the second look changed ${relabelled} labels and withdrew ${withdrawn}`);
if (takenBack) console.log(`  ${takenBack} rulings were taken back after the judge's side was seen; without that file the figures are the blind ones`);

// ---- 1. agreement, run by run ---------------------------------------------
console.log("\n## Agreement with the labels, by run (a rhyme counts only when its reading verifies)");
const scored = pairs.filter((p) => truth.has(p.id));
rulings.forEach((r, i) => {
  const hit = (p: Pair) => (gatedRhyme(r[p.id]!) ? "rhyme" : "no-rhyme") === label(p);
  const by = (k: string) => { const ps = scored.filter((p) => p.kind === k); return `${ps.filter(hit).length}/${ps.length}`; };
  const misses = scored.filter((p) => !hit(p)).map((p) => `${name(p)} [${p.kind}; label ${label(p)}, judge ${r[p.id]!.verdict}/${r[p.id]!.confidence}${r[p.id]!.verified === false ? "/unverified" : ""}]`);
  console.log(` run ${runs[i]}: ${scored.filter(hit).length}/${scored.length}  no-reading ${by("no-reading")}  wrong-reading ${by("wrong-reading")}  stress ${by("stress")}${misses.length ? `\n    ${misses.join("\n    ")}` : ""}`);
});

// ---- 2. every pair: how many runs ruled it a Rhyme --------------------------
console.log("\n## How many runs ruled each pair a Rhyme");
const votes = new Map(pairs.map((p) => [p.id, of(p).filter(gatedRhyme).length]));
const hist: Record<string, number> = {};
for (const p of pairs) { const k = `${votes.get(p.id)}/${N}`; hist[k] = (hist[k] ?? 0) + 1; }
console.log(" pairs by runs that said rhyme:", Object.fromEntries(Object.entries(hist).sort()));
const flips = pairs.filter((p) => { const v = votes.get(p.id)!; return v > 0 && v < N; });
console.log(` pairs that flip: ${flips.length} of ${pairs.length}`);
for (const p of flips.sort((a, b) => votes.get(b.id)! - votes.get(a.id)!)) {
  console.log(`   ${String(votes.get(p.id)).padStart(2)}/${N} rhyme  ${name(p).padEnd(34)} [${p.kind}; label ${label(p)}${truth.get(p.id) ? `, by the ${truth.get(p.id)!.from}` : ""}]  ${of(p).map((r) => (r.verdict === "rhyme" ? (r.verified === false ? "u" : r.confidence[0]!.toUpperCase()) : "-")).join("")}`);
}
console.log("   (per run: H, M, L a rhyme at that confidence; u a rhyme whose reading fails the gate; - no rhyme)");

// ---- 3. the safe slice -------------------------------------------------------
const noReading = pairs.filter((p) => p.kind === "no-reading");
const nrScored = noReading.filter((p) => truth.has(p.id));
console.log(`\n## The safe slice: ${noReading.length} pairs the engine has no reading for (${nrScored.length} labelled: ${nrScored.filter((p) => label(p) === "rhyme").length} rhyme, ${nrScored.filter((p) => label(p) === "no-rhyme").length} no-rhyme)`);
let accepts = 0, wrong = 0, rightPossible = 0, refusedRight = 0;
const wrongList: string[] = [];
rulings.forEach((r, i) => {
  const landed = nrScored.filter((p) => lands(r[p.id]!));
  const bad = landed.filter((p) => label(p) === "no-rhyme");
  const real = nrScored.filter((p) => label(p) === "rhyme");
  accepts += landed.length; wrong += bad.length; rightPossible += real.length; refusedRight += real.filter((p) => !lands(r[p.id]!)).length;
  for (const p of bad) wrongList.push(`run ${runs[i]}: ${name(p)} (${r[p.id]!.reading}) ${r[p.id]!.why}`);
});
console.log(` wrong accepts, every run counted: ${pct(wrong, accepts)}; none wrong would bound the rate at ${upper(accepts)} if runs were independent, ${upper(Math.round(accepts / N))} counting each pair once`);
for (const w of wrongList) console.log(`   WRONG ${w}`);
const fake = nrScored.filter((p) => label(p) === "no-rhyme");
console.log(` non-rhymes refused, every run counted: ${pct(fake.length * N - wrong, fake.length * N)}`);
console.log(` real Rhymes not written, every run counted: ${pct(refusedRight, rightPossible)}`);
const all = nrScored.filter((p) => of(p).every(lands));
const any = nrScored.filter((p) => of(p).some(lands));
const allWrong = all.filter((p) => label(p) === "no-rhyme");
const real = nrScored.filter((p) => label(p) === "rhyme");
console.log(` a Rhyme only when every run agrees: wrong accepts ${pct(allWrong.length, all.length)}${allWrong.length ? `: ${allWrong.map(name).join(", ")}` : ""}`);
console.log(`   it writes ${all.filter((p) => label(p) === "rhyme").length} of the ${real.length} real Rhymes; one run writes ${((rightPossible - refusedRight) / N).toFixed(1)} on average; at least one run writes ${any.filter((p) => label(p) === "rhyme").length}`);
const lost = real.filter((p) => of(p).some(lands) && !of(p).every(lands));
if (lost.length) console.log(`   right accepts the guard costs: ${lost.map((p) => `${name(p)} ${of(p).filter(lands).length}/${N}`).join(", ")}`);
const unl = noReading.filter((p) => !truth.has(p.id) && !dictionary.has(p.id) && of(p).some(lands));
if (unl.length) console.log(` no label, and written by some run: ${unl.map((p) => `${name(p)} ${of(p).filter(lands).length}/${N}`).join(", ")}`);

// ---- 3b. the safe slice at the real mix ---------------------------------------
// A stratum drawn at one pair in five counts five times. The labelled pairs of a stratum stand for all of it,
// which holds for the pairs the maintainer left out only as far as they are like the ones ruled.
if (existsSync(resolve(here, `${set}.strata.json`))) {
  const { every } = load<{ every: Record<string, number> }>(`${set}.strata.json`);
  const atRealMix = (labelOf: (p: Cut) => Label | undefined, who: string) => {
    let acc = 0, bad = 0;
    const parts: string[] = [];
    for (const v of ["rhyme", "ask", "no-rhyme"]) {
      const inS = noReading.filter((p) => p.rule.verdict === v && labelOf(p));
      if (!inS.length) continue;
      const weight = (every[`no-reading/${v}`] ?? 0) / inS.length;
      const a = rulings.reduce((t, r) => t + inS.filter((p) => lands(r[p.id]!)).length, 0);
      const b = rulings.reduce((t, r) => t + inS.filter((p) => lands(r[p.id]!) && labelOf(p) === "no-rhyme").length, 0);
      acc += (weight * a) / N; bad += (weight * b) / N;
      parts.push(`${v} ${b}/${a} of ${inS.length} pairs x${weight.toFixed(2)}`);
    }
    console.log(` at the real mix, labels by ${who}: ${bad.toFixed(1)} wrong of ${acc.toFixed(1)} written a run (${acc ? ((100 * bad) / acc).toFixed(2) : "0.00"}%)  [${parts.join("; ")}]`);
  };
  atRealMix((p) => truth.get(p.id)?.label, "the rules and the maintainer");
  if (dictionary.size) atRealMix((p) => truth.get(p.id)?.label ?? dictionary.get(p.id), "the rules, the maintainer and the dictionary");
}

// ---- 4. between the slices -----------------------------------------------------
console.log("\n## Between the slices: no reading, and a rhyme that is not high confidence or fails the gate");
const between: Record<string, number> = {};
rulings.forEach((r) => { for (const p of nrScored) { const x = r[p.id]!; if (x.verdict === "rhyme" && !lands(x)) { const k = `${x.verified === false ? "fails the gate" : x.confidence} -> label ${label(p)}`; between[k] = (between[k] ?? 0) + 1; } } });
console.log(" pair-runs:", between);
for (const p of nrScored.filter((q) => of(q).some((x) => x.verdict === "rhyme" && !lands(x)))) console.log(`   ${name(p)} [label ${label(p)}] ${of(p).map((r) => (r.verdict === "rhyme" ? (r.verified === false ? "u" : r.confidence[0]!.toUpperCase()) : "-")).join("")}`);

// ---- 5. the risky slice ----------------------------------------------------------
const hasReading = pairs.filter((p) => p.kind !== "no-reading" && truth.has(p.id));
console.log(`\n## The risky slice: ${hasReading.length} labelled pairs where the engine has a reading that misses the key (${hasReading.filter((p) => label(p) === "rhyme").length} are real Rhymes)`);
let over = 0, overWrong = 0, missedReal = 0, realRuns = 0;
rulings.forEach((r) => { for (const p of hasReading) { const g = gatedRhyme(r[p.id]!); if (g) { over++; if (label(p) === "no-rhyme") overWrong++; } if (label(p) === "rhyme") { realRuns++; if (!g) missedReal++; } } });
console.log(` the judge overrules the engine: wrong ${pct(overWrong, over)} of the times it does; real Rhymes it leaves rejected: ${pct(missedReal, realRuns)}`);
for (const p of hasReading.filter((q) => of(q).some(gatedRhyme))) {
  console.log(`   ${String(of(p).filter(gatedRhyme).length).padStart(2)}/${N} rhyme  ${name(p).padEnd(34)} [${p.kind}; label ${label(p)}, by the ${truth.get(p.id)!.from}]  ${of(p).map((r) => (r.verdict === "rhyme" ? (r.verified === false ? "u" : r.confidence[0]!.toUpperCase()) : "-")).join("")}`);
}
for (const p of hasReading.filter((q) => label(q) === "rhyme" && !of(q).some(gatedRhyme))) console.log(`    0/${N} rhyme  ${name(p).padEnd(34)} [${p.kind}; label rhyme]  never overruled`);

// ---- 6. the dictionary's labels ---------------------------------------------------
if (dictionary.size) {
  const dp = pairs.filter((p) => dictionary.has(p.id));
  const d = (p: Pair) => dictionary.get(p.id)!;
  console.log(`
## Dictionary labels: ${dp.length} pairs the maintainer left out, read from Merriam-Webster (${dp.filter((p) => d(p) === "rhyme").length} rhyme, ${dp.filter((p) => d(p) === "no-rhyme").length} no-rhyme); in no figure above unless it says so`);
  const nr = dp.filter((p) => p.kind === "no-reading");
  let acc = 0, bad = 0, realRuns = 0, missed = 0;
  rulings.forEach((r) => { for (const p of nr) { const l = lands(r[p.id]!); if (l) { acc++; if (d(p) === "no-rhyme") bad++; } if (d(p) === "rhyme") { realRuns++; if (!l) missed++; } } });
  console.log(` safe slice, ${nr.length} pairs: wrong accepts, every run counted: ${pct(bad, acc)}; real Rhymes not written: ${pct(missed, realRuns)}`);
  const hr = dp.filter((p) => p.kind !== "no-reading");
  let over = 0, overWrong = 0;
  rulings.forEach((r) => { for (const p of hr) if (gatedRhyme(r[p.id]!)) { over++; if (d(p) === "no-rhyme") overWrong++; } });
  console.log(` risky slice, ${hr.length} pairs: the judge overrules the engine: wrong ${pct(overWrong, over)} of the times it does`);
  for (const p of dp) console.log(`   ${String(of(p).filter(gatedRhyme).length).padStart(2)}/${N} rhyme  ${name(p).padEnd(34)} [${p.kind}; dictionary ${d(p)}]  ${marks(p)}`);
}
