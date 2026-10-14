/**
 * PROTOTYPE, throwaway (#238). Cuts names-1.json: Candidates for the judge's
 * third verdict, "not-a-word". The two measured sets held no real name, so this
 * set is built by hand.
 *
 *   RHYME_BEE_ROOT=<main checkout> npx tsx scripts/judge.prototype/names.ts
 *
 * Every name and non-word below was on the word list until data/demotions.txt
 * took it off, so each is a word the judge would have ruled on before its
 * Demotion. The controls are ordinary words that are also names, which the
 * verdict must leave alone. Its label is the verdict the judge should give,
 * and sound is not scored on this set.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deserialise, type SerialisedIndex } from "../../src/serialise.ts";

const here = import.meta.dirname;
const root = process.env.RHYME_BEE_ROOT ?? resolve(here, "../..");
const manifest = JSON.parse(readFileSync(resolve(root, "dist-data/index.manifest.json"), "utf8"));
const index = deserialise(JSON.parse(readFileSync(resolve(root, "dist-data", manifest.index), "utf8")) as SerialisedIndex);

const NAMES = "kate ate, troy boy, heinz pines, marx parks, niels feels, schelling telling, batz hats, sheard beard, fels bells, franz plants, schwarz warts, algiers years, azores doors, rhodes roads, versailles sky, nepal ball, storting sporting";
const NON_WORDS = "arx parks, ers furs, oct knocked, preceeding leading, hiems dreams, lish fish, kish dish";
const CONTROLS = "sue blue, bill hill, mark park, frank bank, grace face, rose nose, pat hat, will still, rick trick, ray day, jack back, june moon";

const pairs = [[NAMES, "not-a-word"], [NON_WORDS, "not-a-word"], [CONTROLS, "word"]].flatMap(([list, label]) =>
  list!.split(", ").map((pair) => {
    const [word, seedWord] = pair.split(" ") as [string, string];
    const seed = index.pinSeed(seedWord);
    return { id: `${word}|${seed.rhymeKey}`, word, seedWord, rhymeKey: seed.rhymeKey, label, rule: { verdict: "ask" } };
  }));

writeFileSync(resolve(here, "names-1.json"), JSON.stringify(pairs, null, 1));
console.log(`${pairs.length} pairs: ${pairs.filter((p) => p.label === "not-a-word").length} names and non-words, ${pairs.filter((p) => p.label === "word").length} controls`);
