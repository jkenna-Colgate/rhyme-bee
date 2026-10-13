/** PROTOTYPE, throwaway (#238). Is `tern` read as `terns` a one-off, or a class of dictionary error? */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCmudict } from "../../src/cmudict.ts";
import { deserialise, type SerialisedIndex } from "../../src/serialise.ts";
const root = process.env.RHYME_BEE_ROOT ?? resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const manifest = JSON.parse(read("dist-data/index.manifest.json"));
const index = deserialise(JSON.parse(read(`dist-data/${manifest.index}`)) as SerialisedIndex);
const schedule = JSON.parse(read("data/schedule.json")) as { days: { date: string; seed: string; rhymeKey: string }[] };
const dict = parseCmudict(read("data/cmudict.dict"));
const words = new Set(read("data/words.txt").split(/\r?\n/).map((w) => w.trim().toLowerCase()));
const seeds = new Map(schedule.days.map((d) => [d.seed, d]));
// A word whose every reading is also a reading of its own -s form, and ends in the plural's sound.
const hits: string[] = [];
for (const [w, prons] of dict) {
  const plural = dict.get(w + "s");
  if (!plural || !words.has(w) || w.endsWith("s")) continue;
  const same = prons.filter((p) => /^[SZ]$/.test(p[p.length - 1]!) && plural.some((q) => q.join(" ") === p.join(" ")));
  if (!same.length) continue;
  const t = index.tierOf(w);
  hits.push(`${w} ${same[0]!.join(" ")} [${t.tier}${seeds.has(w) ? `, Seed Word on ${seeds.get(w)!.date}` : ""}${same.length < prons.length ? ", has another reading too" : ""}]`);
}
console.log(hits.length, "words on the word list read exactly as their own -s form:");
for (const h of hits) console.log("  ", h);
for (const key of ["ER N Z", "ER N"]) {
  const fam = index.familyOf(key).members;
  const day = schedule.days.find((d) => d.rhymeKey === key);
  console.log(`\n/${key}/: ${fam.length} members, ${fam.filter((m) => m.tier === "answer").length} Answers; scheduled: ${day ? `${day.seed} on ${day.date}` : "no"}`);
  console.log("  ", fam.filter((m) => m.tier === "answer").map((m) => m.word).slice(0, 30).join(", "));
}
