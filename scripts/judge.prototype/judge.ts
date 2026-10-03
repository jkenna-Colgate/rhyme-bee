/**
 * PROTOTYPE, throwaway (#231). The judge: an LLM ruling on pairs inside an
 * environment assembled from named parts, so each part can be switched off and
 * its effect on agreement with the maintainer's rulings measured.
 *
 *   npx tsx scripts/judge.prototype/judge.ts <set> [--env engine,family,relatives,wikipron,shots] [--model sonnet] [--only onfile|unruled] [--limit N]
 *
 * <set> is pool, heldout or batch-N (a JSON file beside this one). Rulings are
 * written to rulings/<set>.<env>.<model>.json and scored against every label
 * available: the rulings on file, and labels/<set>.labels.json when it exists.
 * Raw model output is cached in .scratch/judge/ by prompt, so a re-run only
 * calls the model for prompts it has not already sent.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { rhymeKeyOf } from "../../src/phonology.ts";
import { deserialise, type SerialisedIndex } from "../../src/serialise.ts";
import type { Label, Pair } from "./pool.ts";

const here = import.meta.dirname;
const root = resolve(here, "../..");
const cacheDir = resolve(root, ".scratch/judge/calls");
mkdirSync(cacheDir, { recursive: true });
mkdirSync(resolve(here, "rulings"), { recursive: true });

const PARTS = ["engine", "family", "relatives", "wikipron", "shots"] as const;
type Part = (typeof PARTS)[number];

const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(`--${name}`); return i < 0 ? undefined : argv[i + 1]; };
const set = argv[0]!;
const env = new Set((flag("env") ?? "").split(",").filter(Boolean) as Part[]);
const envName = PARTS.filter((p) => env.has(p)).join("+") || "bare";
const model = flag("model") ?? "sonnet";
const only = flag("only");
const limit = Number(flag("limit") ?? Infinity);
const BATCH = 8;

const load = <T>(p: string): T => JSON.parse(readFileSync(resolve(here, p), "utf8"));
let pairs = load<Pair[]>(`${set}.json`);
if (only === "onfile") pairs = pairs.filter((p) => p.onFile);
if (only === "unruled") pairs = pairs.filter((p) => !p.onFile);
pairs = pairs.slice(0, limit);

// ---- labels: what the judge is scored against, and what shots may quote ----

function labelsIn(file: string): Record<string, Label> {
  const path = resolve(here, "labels", file);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
}
const labelDir = resolve(here, "labels");
const tuningLabels: Record<string, Label> = {};
if (existsSync(labelDir)) {
  for (const f of readdirSync(labelDir)) if (!f.startsWith("heldout")) Object.assign(tuningLabels, labelsIn(f));
}
const truth: Record<string, Label> = { ...Object.fromEntries(pairs.filter((p) => p.onFile).map((p) => [p.id, p.onFile!])), ...labelsIn(`${set}.labels.json`) };

// Shots come from the tuning side only. The held-out set is never quoted to the judge.
const shotPool: (Pair & { label: Label })[] = [];
if (env.has("shots")) {
  const tuning = [...load<Pair[]>("pool.json")];
  for (const f of readdirSync(here)) if (/^batch-\d+\.json$/.test(f)) tuning.push(...load<Pair[]>(f));
  const seen = new Set<string>();
  for (const p of tuning) {
    const label = tuningLabels[p.id] ?? p.onFile;
    if (label && label !== "unsure" && !seen.has(p.id)) { seen.add(p.id); shotPool.push({ ...p, label }); }
  }
}
function shotsFor(p: Pair, batchIds: Set<string>): string[] {
  const rank = (s: Pair) => (s.rhymeKey === p.rhymeKey ? 0 : 2) + (s.kind === p.kind ? 0 : 1);
  const near = shotPool.filter((s) => !batchIds.has(s.id) && (p.kind === "tier") === (s.kind === "tier"))
    .sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
  // At most three of any one label, so a lopsided file cannot teach "always yes".
  const out: string[] = [], per: Record<string, number> = {};
  for (const s of near) {
    if (out.length >= 6) break;
    if ((per[s.label] = (per[s.label] ?? 0) + 1) > 3) continue;
    out.push(`${s.word} for ${s.seedWord}: ${s.label}`);
  }
  return out;
}

// ---- the other environment parts -------------------------------------------

let familyOf: (key: string) => string[] = () => [];
if (env.has("family")) {
  const manifest = JSON.parse(readFileSync(resolve(root, "dist-data/index.manifest.json"), "utf8"));
  const index = deserialise(JSON.parse(readFileSync(resolve(root, "dist-data", manifest.index), "utf8")) as SerialisedIndex);
  familyOf = (key) => index.familyOf(key).members.filter((m) => m.tier === "answer")
    .sort((a, b) => (b.knownness ?? 0) - (a.knownness ?? 0)).slice(0, 14).map((m) => m.word);
}
const wikipron = new Map<string, string[]>();
if (env.has("wikipron")) {
  for (const line of readFileSync(resolve(root, ".scratch/judge/wikipron_us.tsv"), "utf8").split("\n")) {
    const [w, ipa] = line.split("\t");
    if (w && ipa) wikipron.set(w.toLowerCase(), [...(wikipron.get(w.toLowerCase()) ?? []), ipa.replace(/ /g, "")]);
  }
}

// ---- the prompt ------------------------------------------------------------

const RULES = `You are ruling on Candidates for Rhyming Bee, a daily word game. The player is given a Seed Word and types words that rhyme with it. Each Candidate below is a word a player typed that the game did not count. Rule on each as the game's editor would, by ear.

The game adjudicates in merged General American (cot and caught are the same vowel). Two words rhyme when they share a Rhyme Key: the sounds from the word's LAST STRESSED vowel (primary or secondary stress) to the end of the word. Spelling is irrelevant.

Rule each Candidate as exactly one of:
- "rhymes": a real English word (not a name) that an American speaker says with exactly the Seed Word's Rhyme Key. Give its reading in ARPAbet with stress digits. The reading must end in the key's sounds, with stress 1 or 2 on the key's first vowel and no stressed vowel after it.
- "weak": its final syllable has the same sounds as the key, but the stress falls earlier and the final syllable is unstressed (magic for trick). Only possible when the key is one syllable.
- "no-rhyme": a real word whose sounds from its last stressed vowel are not the key.
- "not-a-word": a name, a misspelling, two words run together, or not English.`;

const TIER_RULES = `You are ruling on Tier complaints for Rhyming Bee, a daily word game. The player is given a Seed Word and types words that rhyme with it. Each word below does rhyme and the game accepted it, but only as a Bonus Word (celebrated, unscored) because it is thought to be a word almost nobody would come up with.

Rule each as exactly one of:
- "answer": an ordinary adult American player hunting rhymes for the Seed Word would plausibly think of it and expect it to score.
- "bonus": a real word, but obscure, archaic, technical or a transparent compound hardly anyone would produce.
- "not-a-word": a name, or not really an English word. When in doubt between answer and bonus, rule bonus.`;

const REPLY = `Reply with only a JSON array, one object per Candidate in the order given:
[{"word": "...", "verdict": "...", "reading": "ARPAbet or null", "confidence": "high" | "medium" | "low", "why": "one short sentence"}]`;

function describe(p: Pair, batchIds: Set<string>): string {
  const out = [`- "${p.word}" for the Seed Word "${p.seedWord}"`];
  if (env.has("engine")) {
    if (p.kind !== "tier" && p.seedReading) out[0] += ` (${p.seedRespelling}; reading ${p.seedReading}; Rhyme Key ${p.rhymeKey})`;
    const e = p.evidence;
    out.push(`  engine: ${e.readings.length ? e.readings.map((r) => `${r.phonemes} (key ${r.key})`).join("; ") : "has no reading for it"}; ` +
      `${e.isWord ? "on the word list" : "NOT on the word list"}${e.isName ? "; on the names list" : ""}`);
  }
  if (env.has("family") && p.kind !== "tier") out.push(`  words the game already accepts on this key: ${familyOf(p.rhymeKey).join(", ")}`);
  if (env.has("relatives")) {
    for (const r of p.evidence.relatives.slice(0, 3)) out.push(`  related form "${r.word}": ${r.readings.join("; ")}`);
    if (p.evidence.composed) out.push(`  as a compound of "${p.evidence.composed.head}" + "${p.evidence.composed.tail}": ${p.evidence.composed.phonemes}`);
    if (p.producedBy > 1) out.push(`  typed in ${p.producedBy} separate play-throughs`);
  }
  if (env.has("wikipron")) out.push(`  Wiktionary (US, IPA, stress not marked): ${wikipron.get(p.word)?.join(" or ") ?? "no entry"}`);
  if (env.has("shots")) { const s = shotsFor(p, batchIds); if (s.length) out.push(`  the editor's rulings on nearby pairs: ${s.join("; ")}`); }
  return out.join("\n");
}

interface Ruling { verdict: string; reading: string | null; confidence: string; why: string; verified?: boolean }

function callModel(text: string): Promise<string> {
  const path = resolve(cacheDir, `${model}.${createHash("sha1").update(text).digest("hex").slice(0, 16)}.json`);
  if (existsSync(path)) return Promise.resolve(JSON.parse(readFileSync(path, "utf8")).result);
  return new Promise((done, fail) => {
    // cwd outside the repo so the judge never loads CLAUDE.md, CONTEXT.md or the data.
    const child = spawn("claude", ["-p", "--model", model, "--output-format", "json"], { shell: true, cwd: tmpdir() });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      if (code !== 0) return fail(new Error(`claude exited ${code}: ${err}`));
      const json = JSON.parse(out);
      writeFileSync(path, JSON.stringify({ prompt: text, result: json.result, costUsd: json.total_cost_usd }, null, 1));
      done(json.result ?? "");
    });
    child.stdin.end(text);
  });
}

async function ruleBatch(batch: Pair[]): Promise<[string, Ruling][]> {
  const tier = batch[0]!.kind === "tier";
  const ids = new Set(batch.map((p) => p.id));
  const text = [tier ? TIER_RULES : RULES, "", "Candidates:", ...batch.map((p) => describe(p, ids)), "", REPLY].join("\n");
  const raw = await callModel(text);
  let parsed: Ruling[] = [];
  try { parsed = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1)); } catch { /* scored as no ruling */ }
  return batch.map((p, i) => {
    const r = parsed[i] ?? { verdict: "no-ruling", reading: null, confidence: "low", why: "unparseable reply" };
    // The one mechanical check: a "rhymes" has to come with a reading that computes the key.
    if (r.verdict === "rhymes") r.verified = !!r.reading && rhymeKeyOf(r.reading.trim().toUpperCase().split(/\s+/)) === p.rhymeKey;
    return [p.id, r];
  });
}

async function inParallel<T>(jobs: (() => Promise<T>)[], width: number): Promise<T[]> {
  const results: T[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: width }, async () => {
    while (next < jobs.length) { const i = next++; results[i] = await jobs[i]!(); process.stderr.write("."); }
  }));
  return results;
}

// Batches share a Rhyme Key where they can, as the Candidate Queue is grouped.
const ordered = [...pairs].sort((a, b) => Number(a.kind === "tier") - Number(b.kind === "tier") || a.rhymeKey.localeCompare(b.rhymeKey) || a.id.localeCompare(b.id));
const batches: Pair[][] = [];
for (const p of ordered) {
  const last = batches[batches.length - 1];
  if (last && last.length < BATCH && (last[0]!.kind === "tier") === (p.kind === "tier")) last.push(p);
  else batches.push([p]);
}
process.stderr.write(`${set} / ${envName} / ${model}: ${pairs.length} pairs in ${batches.length} calls `);
const rulings = Object.fromEntries((await inParallel(batches.map((b) => () => ruleBatch(b)), 4)).flat());
process.stderr.write("\n");
writeFileSync(resolve(here, "rulings", `${set}.${envName}.${model}.json`), JSON.stringify(rulings, null, 1));

// ---- score -----------------------------------------------------------------

const scored = pairs.filter((p) => truth[p.id] && truth[p.id] !== "unsure");
console.log(`\n## ${set} / ${envName} / ${model}: ${pairs.length} ruled, ${scored.length} with a label`);
const tallyV: Record<string, number> = {};
for (const p of pairs) tallyV[rulings[p.id]!.verdict] = (tallyV[rulings[p.id]!.verdict] ?? 0) + 1;
console.log("verdicts:", tallyV, "| rhymes without a verifying reading:", pairs.filter((p) => rulings[p.id]!.verified === false).length);
if (scored.length) {
  const agree = (ps: Pair[]) => `${ps.filter((p) => rulings[p.id]!.verdict === truth[p.id]).length}/${ps.length}`;
  console.log("agreement:", agree(scored));
  for (const kind of new Set(scored.map((p) => p.kind))) console.log(`  ${kind}: ${agree(scored.filter((p) => p.kind === kind))}`);
  for (const c of ["high", "medium", "low"]) console.log(`  confidence ${c}: ${agree(scored.filter((p) => rulings[p.id]!.confidence === c))}`);
  const confusion: Record<string, number> = {};
  for (const p of scored) { const k = `${truth[p.id]} -> ${rulings[p.id]!.verdict}`; confusion[k] = (confusion[k] ?? 0) + 1; }
  console.log("maintainer -> judge:", confusion);
  const misses = scored.filter((p) => rulings[p.id]!.verdict !== truth[p.id]);
  for (const p of misses.slice(0, 40)) console.log(`  MISS ${p.word} for ${p.seedWord} [${p.kind}] maintainer ${truth[p.id]}, judge ${rulings[p.id]!.verdict} (${rulings[p.id]!.confidence}): ${rulings[p.id]!.why}`);
}
