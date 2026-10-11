/** PROTOTYPE, throwaway (#238). What Tier would a safe-slice word land in once it has a reading? */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deserialise, type SerialisedIndex } from "../../src/serialise.ts";
import type { Pair } from "./pool.ts";
const here = import.meta.dirname;
const root = process.env.RHYME_BEE_ROOT ?? resolve(here, "../..");
const manifest = JSON.parse(readFileSync(resolve(root, "dist-data/index.manifest.json"), "utf8"));
const index = deserialise(JSON.parse(readFileSync(resolve(root, "dist-data", manifest.index), "utf8")) as SerialisedIndex);
for (const set of process.argv.slice(2)) {
  const pairs = (JSON.parse(readFileSync(resolve(here, `${set}.json`), "utf8")) as (Pair & { rule: { verdict: string } })[]).filter((p) => p.kind === "no-reading" && p.rule.verdict !== "out");
  const t: Record<string, number> = {};
  const eg: Record<string, string[]> = {};
  for (const p of pairs) { const x = index.tierOf(p.word); const k = `${x.tier}${x.knownness === null ? " (no prevalence figure)" : ""}`; t[k] = (t[k] ?? 0) + 1; (eg[k] ??= []).push(p.word); }
  console.log(set, pairs.length, "no-reading pairs:", t);
  for (const k in eg) console.log("  ", k, ":", eg[k]!.slice(0, 14).join(", "));
}
