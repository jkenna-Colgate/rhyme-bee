/**
 * PROTOTYPE, throwaway (#231). Cuts review batch N: about 40 unruled pairs from
 * the tuning pool that no earlier batch took, leaning toward the kinds the
 * maintainer is likeliest to refuse, since the rulings on file are all "yes".
 *
 *   npx tsx scripts/judge.prototype/batch.ts 1
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Kind, Pair } from "./pool.ts";

const here = import.meta.dirname;
const n = Number(process.argv[2]);
const out = resolve(here, `batch-${n}.json`);
if (existsSync(out)) throw new Error(`batch-${n}.json exists; a batch is cut once`);

const taken = new Set<string>();
for (const f of readdirSync(here)) {
  if (/^batch-\d+\.json$/.test(f)) for (const p of JSON.parse(readFileSync(resolve(here, f), "utf8")) as Pair[]) taken.add(p.id);
}
const pool = (JSON.parse(readFileSync(resolve(here, "pool.json"), "utf8")) as Pair[]).filter((p) => !p.onFile && !taken.has(p.id));

const QUOTA: Record<Kind, number> = { "wrong-reading": 16, stress: 8, "no-reading": 10, "no-wordhood": 2, tier: 4 };
// Deterministic spread: order by a hash of the id salted with the batch number.
const hash = (s: string) => { let h = n; for (const c of s) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0; return h; };
const batch: Pair[] = [];
for (const kind of Object.keys(QUOTA) as Kind[]) {
  const perKey = new Map<string, number>();
  let got = 0;
  for (const p of pool.filter((x) => x.kind === kind).sort((a, b) => hash(a.id) - hash(b.id))) {
    if (got >= QUOTA[kind]) break;
    if ((perKey.get(p.rhymeKey) ?? 0) >= 3) continue;
    perKey.set(p.rhymeKey, (perKey.get(p.rhymeKey) ?? 0) + 1);
    batch.push(p);
    got++;
  }
}
writeFileSync(out, JSON.stringify(batch, null, 1));
console.log(out, batch.length, "pairs:", batch.map((p) => `${p.word}~${p.seedWord}`).join(", "));
