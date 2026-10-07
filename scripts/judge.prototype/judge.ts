/**
 * PROTOTYPE, throwaway (#231). The judge: an LLM ruling on pairs inside an
 * environment assembled from named parts, so each part can be switched off and
 * its effect on agreement with the labels measured.
 *
 *   npx tsx scripts/judge.prototype/judge.ts <set> [--env engine,family,relatives,wikipron,shots] [--model sonnet] [--limit N] [--dry]
 *
 * <set> is heldout-2 or batch-N (a JSON file beside this one, each pair carrying
 * the rules' own decision). The judge is asked about Points only: is this pair
 * a Rhyme, given the right reading. Its instructions are the rules of #232, the
 * same ones the labels follow. It is never asked about a Weak Rhyme.
 *
 * Rulings are written to rulings/<set>.<env>.<model>.json and scored against
 * labels/<set>.rules.json (what the rules decided) and labels/<set>.labels.json
 * (what the maintainer ruled where they could not). Raw model output is cached
 * in .scratch/judge/ by prompt, so a re-run only calls the model for prompts it
 * has not already sent. --dry prints the first prompt and calls nothing.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { deserialise, type SerialisedIndex } from "../../src/serialise.ts";
import type { Pair } from "./pool.ts";
import { canon, ruleKeys, substitutionBreaks, type Decision } from "./rules.ts";

const here = import.meta.dirname;
const root = resolve(here, "../..");
const cacheDir = resolve(root, ".scratch/judge/calls");
mkdirSync(cacheDir, { recursive: true });
mkdirSync(resolve(here, "rulings"), { recursive: true });

const PARTS = ["engine", "family", "relatives", "wikipron", "shots"] as const;
type Part = (typeof PARTS)[number];
type Label = "rhyme" | "no-rhyme";
type Ruled = Pair & { rule: Decision };

const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(`--${name}`); return i < 0 ? undefined : argv[i + 1]; };
const set = argv[0]!;
const env = new Set((flag("env") ?? "").split(",").filter(Boolean) as Part[]);
const envName = PARTS.filter((p) => env.has(p)).join("+") || "bare";
const model = flag("model") ?? "sonnet";
const limit = Number(flag("limit") ?? Infinity);
const dry = argv.includes("--dry");
const BATCH = 8;

const load = <T>(p: string): T => JSON.parse(readFileSync(resolve(here, p), "utf8"));
const pairs = load<Ruled[]>(`${set}.json`).filter((p) => p.rule.verdict !== "out").slice(0, limit);

// ---- labels: what the judge is scored against, and what shots may quote ----

const labelDir = resolve(here, "labels");
function labelsIn(file: string): Record<string, string> {
  const path = resolve(labelDir, file);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
}
const isLabel = (l: string | undefined): l is Label => l === "rhyme" || l === "no-rhyme";
/** A label and where it came from. The maintainer's ruling is only ever on a pair the rules left open. */
const truth = new Map<string, { label: Label; from: "rules" | "maintainer" }>();
for (const [id, l] of Object.entries(labelsIn(`${set}.rules.json`))) if (isLabel(l)) truth.set(id, { label: l, from: "rules" });
for (const [id, l] of Object.entries(labelsIn(`${set}.labels.json`))) if (isLabel(l)) truth.set(id, { label: l, from: "maintainer" });

// Shots come from the tuning side only. A held-out set is never quoted to the judge.
const shotPool: (Pair & { label: Label })[] = [];
if (env.has("shots")) {
  for (const f of readdirSync(here).filter((x) => /^batch-\d+\.json$/.test(x))) {
    const name = f.replace(".json", "");
    const known = { ...labelsIn(`${name}.rules.json`), ...labelsIn(`${name}.labels.json`) };
    for (const p of load<Pair[]>(f)) { const l = known[p.id]; if (isLabel(l)) shotPool.push({ ...p, label: l }); }
  }
}
function shotsFor(p: Pair, batchIds: Set<string>): string[] {
  const rank = (s: Pair) => (s.rhymeKey === p.rhymeKey ? 0 : 2) + (s.kind === p.kind ? 0 : 1);
  const near = shotPool.filter((s) => !batchIds.has(s.id)).sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
  // At most three of either label, so a lopsided set cannot teach "always yes".
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

const RULES = `You are ruling on Candidates for Rhyming Bee, a daily word game. The player is given a Seed Word and types words that rhyme with it. Each Candidate below is a word a player typed that the game did not score. Every Candidate is on the game's word list, so do not rule on whether it is a word, and do not rule on how well known it is. Rule on one thing: is the pair a Rhyme? A Rhyme is what scores.

The game adjudicates in merged General American (cot and caught are the same vowel). It is generous about stress and strict about sound.

THE RULE. A word's Rhyme Key is the rime of its last stressed syllable (its vowel and the consonants after that vowel) together with every syllable after it. The consonants before the vowel are ignored. The stressed syllable may carry main or secondary stress, and the game draws no line between the two: "copycat" has the Rhyme Key of "cat", "adjudicate" of "ate". The pair is a Rhyme when the Candidate, as General American says it, has exactly the Seed Word's Rhyme Key. Spelling is irrelevant. A word may be said more than one way, and one way that fits is enough.

NOT A RHYME:
- Any differing sound in the vowel or after it, a one-sound difference included ("pollution" for "delusion", "time" for "fine").
- A match only on an unstressed last syllable ("magic" for "trick", "stylish" for "dish", "boulder" for "fur", "facility" for "tree").
- An extra or missing syllable ("serial" for "meal", "betrayal" for "male"), except for the r reading below.

READ AS THE SAME:
- After the stressed vowel of the Rhyme Key, weak "ih" and weak "uh" (ARPAbet IH0 and AH0) are one sound: "utility" for "facility", "annotated" for "abated", "direction" for "collection".
- After "eye", "ow" or "oy" (AY, AW, OY), "er" and plain r are read as each other: "higher" for "fire", "flower" for "hour".

ALSO A RHYME: a homophone of the Seed Word; a longer word whose last part is the Seed Word; a compound, whose last part keeps a secondary stress ("carsick" and "drumstick" for "trick").

A Rhyme holds in both directions. If the Candidate is a Rhyme for the Seed Word, then the Seed Word is a Rhyme for the Candidate, and every word that rhymes with one rhymes with the other. If you would not rule it both ways, it is not a Rhyme.

Rule each Candidate as exactly one of:
- "rhyme": give the reading that makes it one, in ARPAbet with stress digits. The reading must put stress 1 or 2 on the first vowel of the Seed Word's Rhyme Key and no stressed vowel after it.
- "no-rhyme": however General American says the word, it does not have the Seed Word's Rhyme Key.`;

const REPLY = `Reply with only a JSON array, one object per Candidate in the order given:
[{"word": "...", "verdict": "rhyme" | "no-rhyme", "reading": "ARPAbet or null", "confidence": "high" | "medium" | "low", "why": "one short sentence"}]`;

function describe(p: Pair, batchIds: Set<string>): string {
  const out = [`- "${p.word}" for the Seed Word "${p.seedWord}"`];
  if (env.has("engine")) {
    if (p.seedReading) out[0] += ` (${p.seedRespelling}; reading ${p.seedReading}; Rhyme Key ${p.rhymeKey})`;
    const e = p.evidence;
    out.push(`  the game's dictionary: ${e.readings.length ? e.readings.map((r) => `${r.phonemes} (Rhyme Key ${r.key})`).join("; ") : "has no reading for it"}`);
  }
  if (env.has("family")) out.push(`  words the game already scores on this Rhyme Key: ${familyOf(p.rhymeKey).join(", ")}`);
  if (env.has("relatives")) {
    for (const r of p.evidence.relatives.slice(0, 3)) out.push(`  related form "${r.word}": ${r.readings.join("; ")}`);
    if (p.evidence.composed) out.push(`  as a compound of "${p.evidence.composed.head}" + "${p.evidence.composed.tail}": ${p.evidence.composed.phonemes}`);
    if (p.producedBy > 1) out.push(`  typed in ${p.producedBy} separate play-throughs`);
  }
  if (env.has("wikipron")) out.push(`  Wiktionary (US, IPA, stress not marked): ${wikipron.get(p.word)?.join(" or ") ?? "no entry"}`);
  if (env.has("shots")) { const s = shotsFor(p, batchIds); if (s.length) out.push(`  rulings already made on nearby pairs: ${s.join("; ")}`); }
  return out.join("\n");
}

interface Ruling { verdict: string; reading: string | null; confidence: string; why: string; verified?: boolean }

function callModel(text: string): Promise<string> {
  const path = resolve(cacheDir, `${model}.${createHash("sha1").update(text).digest("hex").slice(0, 16)}.json`);
  if (existsSync(path)) return Promise.resolve(JSON.parse(readFileSync(path, "utf8")).result);
  return new Promise((done, fail) => {
    // cwd outside the repo so the judge never loads CLAUDE.md, GLOSSARY.md or the data.
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

const promptFor = (batch: Pair[]) => {
  const ids = new Set(batch.map((p) => p.id));
  return [RULES, "", "Candidates:", ...batch.map((p) => describe(p, ids)), "", REPLY].join("\n");
};

async function ruleBatch(batch: Pair[]): Promise<[string, Ruling][]> {
  const raw = await callModel(promptFor(batch));
  let parsed: Ruling[] = [];
  try { parsed = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1)); } catch { /* scored as no ruling */ }
  return batch.map((p, i) => {
    const r = parsed[i] ?? { verdict: "no-ruling", reading: null, confidence: "low", why: "unparseable reply" };
    // The one mechanical check: a "rhyme" has to come with a reading that reaches the key under the rules.
    if (r.verdict === "rhyme") r.verified = !!r.reading && ruleKeys(p.word, [r.reading.trim().toUpperCase().split(/\s+/)]).has(canon(p.rhymeKey));
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
const ordered = [...pairs].sort((a, b) => a.rhymeKey.localeCompare(b.rhymeKey) || a.id.localeCompare(b.id));
const batches: Pair[][] = [];
for (const p of ordered) {
  const last = batches[batches.length - 1];
  if (last && last.length < BATCH) last.push(p); else batches.push([p]);
}
process.stderr.write(`${set} / ${envName} / ${model}: ${pairs.length} pairs in ${batches.length} calls `);
if (dry) { console.log(`\n${promptFor(batches[0]!)}`); process.exit(0); }
const rulings = Object.fromEntries((await inParallel(batches.map((b) => () => ruleBatch(b)), 4)).flat());
process.stderr.write("\n");
writeFileSync(resolve(here, "rulings", `${set}.${envName}.${model}.json`), JSON.stringify(rulings, null, 1));

// ---- score -----------------------------------------------------------------

const scored = pairs.filter((p) => truth.has(p.id));
console.log(`\n## ${set} / ${envName} / ${model}: ${pairs.length} ruled, ${scored.length} with a label`);
const tallyV: Record<string, number> = {};
for (const p of pairs) tallyV[rulings[p.id]!.verdict] = (tallyV[rulings[p.id]!.verdict] ?? 0) + 1;
console.log("verdicts:", tallyV, "| rhyme without a verifying reading:", pairs.filter((p) => rulings[p.id]!.verified === false).length);
// The judge's own rulings must keep the substitution property too.
console.log("substitution breaks in the judge's rulings:", substitutionBreaks(pairs.map((p) => ({ word: p.word, rhymeKey: p.rhymeKey, label: rulings[p.id]!.verdict }))));
if (scored.length) {
  const hit = (p: Pair) => rulings[p.id]!.verdict === truth.get(p.id)!.label;
  const agree = (ps: Pair[]) => `${ps.filter(hit).length}/${ps.length}`;
  console.log("agreement:", agree(scored));
  for (const from of ["rules", "maintainer"] as const) console.log(`  labelled by the ${from}: ${agree(scored.filter((p) => truth.get(p.id)!.from === from))}`);
  for (const kind of new Set(scored.map((p) => p.kind))) console.log(`  ${kind}: ${agree(scored.filter((p) => p.kind === kind))}`);
  for (const c of ["high", "medium", "low"]) console.log(`  confidence ${c}: ${agree(scored.filter((p) => rulings[p.id]!.confidence === c))}`);
  const confusion: Record<string, number> = {};
  for (const p of scored) { const k = `${truth.get(p.id)!.label} -> ${rulings[p.id]!.verdict}`; confusion[k] = (confusion[k] ?? 0) + 1; }
  console.log("label -> judge:", confusion);
  for (const p of scored.filter((x) => !hit(x)).slice(0, 40)) {
    const t = truth.get(p.id)!, r = rulings[p.id]!;
    console.log(`  MISS ${p.word} for ${p.seedWord} [${p.kind}, by the ${t.from}] label ${t.label}, judge ${r.verdict} (${r.confidence}): ${r.why}`);
  }
}
