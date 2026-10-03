/**
 * PROTOTYPE, throwaway (#231). Cuts the review set of rulings ON FILE that the
 * judge disagrees with, so the maintainer can say which of the two is wrong.
 *
 *   npx tsx scripts/judge.prototype/disputed.ts <rulings.json>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Pair } from "./pool.ts";

const here = import.meta.dirname;
const rulings = JSON.parse(readFileSync(resolve(process.argv[2]!), "utf8")) as Record<string, { verdict: string }>;
const pool = JSON.parse(readFileSync(resolve(here, "pool.json"), "utf8")) as Pair[];
const disputed = pool.filter((p) => p.onFile && rulings[p.id] && rulings[p.id]!.verdict !== p.onFile);
writeFileSync(resolve(here, "disputed.json"), JSON.stringify(disputed, null, 1));
console.log(disputed.length, "rulings on file the judge disagrees with");
