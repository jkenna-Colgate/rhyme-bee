/**
 * PROTOTYPE, throwaway (#238). Cuts a second-look set from a scored set: every
 * labelled pair where most runs of the judge disagree with the label, mixed
 * with as many pairs where every run agrees, so the page does not say which
 * is which. The maintainer rules them blind and the labels replace the old ones.
 *
 *   npx tsx scripts/judge.prototype/recheck.ts fresh-1 1 2 3 4 5
 *   npx tsx scripts/judge.prototype/labeller.ts fresh-1-recheck
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Pair } from "./pool.ts";

const here = import.meta.dirname;
const [set, ...runArgs] = process.argv.slice(2);
const runs = runArgs.map(Number);
if (!set || !runs.length) throw new Error("usage: recheck.ts <set> <run> [<run> ...]");
const load = <T>(p: string): T => JSON.parse(readFileSync(resolve(here, p), "utf8"));
const labelsIn = (f: string): Record<string, string> => (existsSync(resolve(here, "labels", f)) ? load(`labels/${f}`) : {});
interface Ruling { verdict: string; verified?: boolean }

const DROPPED = new Set(["unlearns|ER N Z", "sojourns|ER N Z"]);
const pairs = load<(Pair & { rule: { verdict: string; why: string } })[]>(`${set}.json`).filter((p) => !DROPPED.has(p.id));
const truth = new Map<string, { label: string; from: string }>();
for (const [id, l] of Object.entries(labelsIn(`${set}.rules.json`))) truth.set(id, { label: l, from: "rules" });
for (const [id, l] of Object.entries(labelsIn(`${set}.labels.json`))) if (l !== "out") truth.set(id, { label: l, from: "maintainer" });
const rulings = runs.map((n) => load<Record<string, Ruling>>(`rulings/${set}.bare.rules-2${n > 1 ? `.run-${n}` : ""}.sonnet.json`));
/** As margin.ts counts it: a rhyme whose reading fails the gate writes nothing, so it is no dispute. */
const votes = (p: Pair) => rulings.filter((r) => r[p.id]!.verdict === "rhyme" && r[p.id]!.verified !== false).length;

// mulberry32, so the cut is the same every time it is made
let s = 238;
const rand = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const shuffled = <T>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [b[i], b[j]] = [b[j]!, b[i]!]; } return b; };

const labelled = pairs.filter((p) => truth.has(p.id));
const disputed = labelled.filter((p) => (votes(p) * 2 > runs.length ? "rhyme" : "no-rhyme") !== truth.get(p.id)!.label);
const agreed = labelled.filter((p) => votes(p) === (truth.get(p.id)!.label === "rhyme" ? runs.length : 0));
const controls: typeof pairs = [];
for (const from of ["rules", "maintainer"]) for (const label of ["rhyme", "no-rhyme"]) {
  const want = disputed.filter((p) => truth.get(p.id)!.from === from && truth.get(p.id)!.label !== label).length;
  controls.push(...shuffled(agreed.filter((p) => truth.get(p.id)!.from === from && truth.get(p.id)!.label === label)).slice(0, want));
}
const isDisputed = new Set(disputed.map((p) => p.id));
const cut = shuffled([...disputed, ...controls]).map((p) => ({ ...p, rule: { verdict: "ask", why: "A second look at a pair that already has a label. Nothing about that label is shown." } }));
writeFileSync(resolve(here, `${set}-recheck.json`), JSON.stringify(cut, null, 1));
writeFileSync(resolve(here, `${set}-recheck.was.json`), JSON.stringify(Object.fromEntries(cut.map((p) => [p.id, { ...truth.get(p.id)!, runsThatSaidRhyme: votes(p), disputed: isDisputed.has(p.id) }])), null, 1));
console.log(`${cut.length} pairs: ${disputed.length} the judge disputes (${disputed.filter((p) => truth.get(p.id)!.from === "rules").length} labelled by the rules, ${disputed.filter((p) => truth.get(p.id)!.from === "maintainer").length} by the maintainer) and ${controls.length} it agrees with`);
