/** PROTOTYPE, throwaway (#238). How many Seed Words have more than one Rhyme Key? */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deserialise, type SerialisedIndex } from "../../src/serialise.ts";
const root = process.env.RHYME_BEE_ROOT ?? resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const manifest = JSON.parse(read("dist-data/index.manifest.json"));
const index = deserialise(JSON.parse(read(`dist-data/${manifest.index}`)) as SerialisedIndex);
const schedule = JSON.parse(read("data/schedule.json")) as { days: { date: string; seed: string; rhymeKey: string }[] };
const multi = schedule.days.map((d) => ({ ...d, keys: index.rhymeKeysOf(d.seed) })).filter((d) => d.keys.length > 1);
console.log(`${multi.length} of ${schedule.days.length} scheduled Seed Words have more than one Rhyme Key`);
for (const d of multi) console.log(`  ${d.date} ${d.seed.padEnd(16)} pinned /${d.rhymeKey}/  also ${d.keys.filter((k) => k !== d.rhymeKey).map((k) => `/${k}/`).join(" ")}`);
const none = schedule.days.filter((d) => !index.rhymeKeysOf(d.seed).includes(d.rhymeKey));
console.log(`${none.length} scheduled Seed Words do not have their scheduled Rhyme Key:`, none.map((d) => `${d.seed} ${d.date}`).join(", "));
