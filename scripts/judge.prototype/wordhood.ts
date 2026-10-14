/**
 * PROTOTYPE, throwaway (#238). Asks the judge about wordhood as a question of
 * its own, so the rhyme prompt stays the wording the margin was measured on.
 * Folding a "not-a-word" verdict into that prompt (--rules 3 in judge.ts) caught
 * the names and cost real Rhymes their high confidence, so it was set aside.
 *
 *   RHYME_BEE_ROOT=<main checkout> npx tsx scripts/judge.prototype/wordhood.ts <set> [<set> ...] [--run N]
 *
 * Every word in the sets is asked once. names-1 carries its own label and is
 * scored; on the other sets the words are on the word list and nearly all are
 * ordinary words, so what is printed is every word the judge would hold back.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const here = import.meta.dirname;
const root = process.env.RHYME_BEE_ROOT ?? resolve(here, "../..");
const cacheDir = resolve(root, ".scratch/judge/calls");
mkdirSync(cacheDir, { recursive: true });
const argv = process.argv.slice(2);
const at = argv.indexOf("--run");
const run = at < 0 ? 1 : Number(argv.splice(at, 2)[1]);
const sets = argv;
const model = "sonnet";
const BATCH = 20;

const ASK = `You are checking words for Rhyming Bee, a daily word game in which players type English words. Every word below is on the game's word list, but the list holds some names and some strings that are not words, and the game never scores either. Rule each word as exactly one of:
- "word": an English word, however rare. A word that is also a name is a word ("sue", "bill", "grace"), and so is a regular form of a word (a plural, a past tense, an -ing form) or a compound.
- "name": only a name, of a person, a place, a brand or the like.
- "not-a-word": not an English word at all: an abbreviation, a misspelling, a fragment, or a word from another language.

Reply with only a JSON array, one object per word in the order given:
[{"word": "...", "verdict": "word" | "name" | "not-a-word", "confidence": "high" | "medium" | "low", "why": "one short sentence"}]`;

interface Ruling { word: string; verdict: string; confidence: string; why: string }

function callModel(text: string): Promise<string> {
  const path = resolve(cacheDir, `${model}.${createHash("sha1").update(text).digest("hex").slice(0, 16)}${run > 1 ? `.run-${run}` : ""}.json`);
  if (existsSync(path)) return Promise.resolve(JSON.parse(readFileSync(path, "utf8")).result);
  return new Promise((done, fail) => {
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

const lastArray = (raw: string): Ruling[] => {
  const end = raw.lastIndexOf("]");
  for (let i = raw.lastIndexOf("[", end); i >= 0; i = raw.lastIndexOf("[", i - 1)) {
    try { const got = JSON.parse(raw.slice(i, end + 1)); if (Array.isArray(got)) return got; } catch { /* an earlier bracket may open it */ }
    if (i === 0) break;
  }
  return [];
};

type Pair = { word: string; label?: string; rule: { verdict: string } };
const bySet = new Map(sets.map((s) => [s, (JSON.parse(readFileSync(resolve(here, `${s}.json`), "utf8")) as Pair[]).filter((p) => p.rule.verdict !== "out")]));
const words = [...new Set([...bySet.values()].flat().map((p) => p.word))].sort();
const batches = Array.from({ length: Math.ceil(words.length / BATCH) }, (_, i) => words.slice(i * BATCH, (i + 1) * BATCH));
process.stderr.write(`${words.length} words in ${batches.length} calls `);

const ruled = new Map<string, Ruling>();
let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < batches.length) {
    const b = batches[next++]!;
    const got = lastArray(await callModel([ASK, "", "Words:", ...b.map((w) => `- ${w}`)].join("\n")));
    b.forEach((w, i) => ruled.set(w, got[i]?.word === w ? got[i]! : { word: w, verdict: "no-ruling", confidence: "low", why: "unparseable reply" }));
    process.stderr.write(".");
  }
}));
process.stderr.write("\n");
writeFileSync(resolve(here, "rulings", `wordhood.${sets.join("+")}${run > 1 ? `.run-${run}` : ""}.${model}.json`), JSON.stringify(Object.fromEntries(ruled), null, 1));

const show = (w: string) => `${w} (${ruled.get(w)!.verdict}/${ruled.get(w)!.confidence})`;
for (const [s, pairs] of bySet) {
  const ws = [...new Set(pairs.map((p) => p.word))];
  const held = ws.filter((w) => ruled.get(w)!.verdict !== "word");
  console.log(`\n## ${s}: ${ws.length} words, ${held.length} held back`);
  const labelled = pairs.filter((p) => p.label);
  if (labelled.length) for (const want of ["not-a-word", "word"]) {
    const ps = labelled.filter((p) => p.label === want);
    const miss = ps.filter((p) => (ruled.get(p.word)!.verdict === "word") === (want === "not-a-word"));
    console.log(`  ${want === "word" ? "words that are also names, left alone" : "names and non-words caught"}: ${ps.length - miss.length}/${ps.length}${miss.length ? `; missed ${miss.map((p) => `${show(p.word)}: ${ruled.get(p.word)!.why}`).join("; ")}` : ""}`);
  }
  else if (held.length) console.log(`  ${held.map((w) => `${show(w)}: ${ruled.get(w)!.why}`).join("\n  ")}`);
}
