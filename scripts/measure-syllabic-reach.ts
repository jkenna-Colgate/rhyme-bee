/**
 * Enumerate what the syllabic-consonant rule (ADR-0010, #74) actually moves, and
 * draw a sample of it for judging (#211).
 *
 *   tsx scripts/measure-syllabic-reach.ts [--sample N] [--seed S] [--out FILE]
 *
 * The population is **words the rule gives a new Rhyme partner**, not words it
 * rewrites: most words that gain a schwa-less reading gain it alongside their
 * whole family, so both keys hold the same members and no verdict moves. The two
 * figures differ by about a factor of five, and only the smaller one is a claim
 * about rhyme. #209 measured its own proposed fix and nobody re-ran it, which is
 * how its figures went stale (#152) — hence a script rather than a probe.
 *
 * ## How a rule-produced reading is identified
 *
 * By its *effect*, never by restating the rule's conditions. The build is run
 * twice over the same pinned inputs: once through `manufactureIndexData`, and
 * once stopping short of normalisation. A reading is the syllabic rule's work
 * when it is in the finished readings, absent before normalisation, and is
 * another finished reading with the unstressed schwa before the final `L`/`N`/`M`
 * removed. Nothing else in normalisation deletes a phoneme, so the shape is
 * unambiguous — and a condition added to or dropped from the rule changes what
 * this script counts without the script needing to be told.
 *
 * The pre-normalisation build repeats `manufacture.ts`'s stage order, which is
 * the one thing here that could drift from the real build. So it is checked
 * rather than trusted: normalising it must reproduce the manufactured readings
 * exactly, and the script fails if it does not.
 *
 * Reachability is computed on literal Rhyme Keys, with no Schwa Twin fallback.
 * `schwaTwins.ts` restates this same rule against the key string, so consulting
 * it would fold the rule's own output back in and report that nothing moved.
 *
 * Requires `data/`; does not read the built artifact.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCmudict } from "../src/cmudict.ts";
import { applyCoverage } from "../src/coverage.ts";
import { applyDemotions } from "../src/demotions.ts";
import { manufactureIndexData } from "../src/manufacture.ts";
import { applyNormalisation } from "../src/normalise.ts";
import { bareSound, rhymeKeyOf, stressOf, type Pronunciation } from "../src/phonology.ts";
import { parsePrevalenceCsv, parseWordList } from "../src/pipeline.ts";
import { RhymeIndex } from "../src/rhymeIndex.ts";
import { applySupplement } from "../src/supplement.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(root, "data");
const read = (name: string) => readFileSync(resolve(dataDir, name), "utf8");
const readOptional = (name: string) => {
  try {
    return read(name);
  } catch {
    return "";
  }
};

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : (args[at + 1] ?? fallback);
};
const SAMPLE = Number(flag("sample", "100"));
const SEED = Number(flag("seed", "211"));
const OUT = flag("out", "");

const SONORANTS = new Set(["L", "N", "M"]);
const SCHWA = "AH";

const inputs = {
  cmudict: read("cmudict.dict"),
  words: read("words.txt"),
  names: read("names.txt"),
  prevalence: read("prevalence.csv"),
  demotions: readOptional("demotions.txt"),
  supplement: readOptional("supplement.dict"),
  tierOverrides: readOptional("tier-overrides.csv"),
};

const { data } = manufactureIndexData(inputs);

/** The same inputs through the same stages, stopping before normalisation. */
function buildBeforeNormalisation(): Map<string, Pronunciation[]> {
  const pronunciations = parseCmudict(inputs.cmudict);
  const words = parseWordList(inputs.words);
  const names = parseWordList(inputs.names);
  const prevalence = parsePrevalenceCsv(inputs.prevalence);
  applyDemotions(inputs.demotions, { words, names });
  applySupplement(inputs.supplement, { pronunciations, words, names });
  applyCoverage({ pronunciations, words, names, prevalence });
  return pronunciations;
}

const before = buildBeforeNormalisation();

// The stage replication is the only thing here that can silently go stale, so
// it is verified: normalising it must land on the readings the build shipped.
const check = new Map([...before].map(([w, rs]) => [w, rs.map((r) => [...r])]));
applyNormalisation({ pronunciations: check });
const serialise = (map: Map<string, Pronunciation[]>) =>
  [...map].map(([w, rs]) => `${w}\t${rs.map((r) => r.join(" ")).join("|")}`).join("\n");
if (serialise(check) !== serialise(data.pronunciations)) {
  console.error(
    "Pre-normalisation build does not reproduce the manufactured readings.\n" +
      "manufacture.ts's stage order has changed — update buildBeforeNormalisation.",
  );
  process.exit(1);
}

const playable = (word: string) => data.words.has(word) && !data.names.has(word);

/** Every playable word's Rhyme Keys, and every key's members. */
const keysOf = new Map<string, Set<string>>();
const membersOf = new Map<string, Set<string>>();
for (const [word, readings] of data.pronunciations) {
  if (!playable(word)) continue;
  const keys = new Set<string>();
  for (const reading of readings) {
    const key = rhymeKeyOf(reading);
    if (key !== null) keys.add(key);
  }
  keysOf.set(word, keys);
  for (const key of keys) {
    let members = membersOf.get(key);
    if (!members) membersOf.set(key, (members = new Set()));
    members.add(word);
  }
}

/** True if `dropped` is `full` minus an unstressed schwa before a final sonorant. */
function isSchwaDrop(full: Pronunciation, dropped: Pronunciation): boolean {
  const sonorant = full.at(-1);
  const schwa = full.at(-2);
  if (sonorant === undefined || schwa === undefined) return false;
  if (!SONORANTS.has(sonorant)) return false;
  if (bareSound(schwa) !== SCHWA || stressOf(schwa) !== 0) return false;
  return dropped.join(" ") === [...full.slice(0, -2), sonorant].join(" ");
}

interface Moved {
  word: string;
  /** The reading the rule appended, and the key it lands on. */
  reading: Pronunciation;
  key: string;
  /** Words this word rhymes with only because of that reading. */
  partners: string[];
}

const rewritten = new Set<string>();
const moved: Moved[] = [];
for (const [word, readings] of data.pronunciations) {
  if (!playable(word)) continue;
  const wasThere = new Set((before.get(word) ?? []).map((r) => r.join(" ")));
  for (const reading of readings) {
    if (wasThere.has(reading.join(" "))) continue;
    if (!readings.some((full) => isSchwaDrop(full, reading))) continue;
    rewritten.add(word);

    const key = rhymeKeyOf(reading);
    if (key === null) continue;
    const otherwise = new Set<string>([word]);
    for (const other of keysOf.get(word) ?? []) {
      if (other === key) continue;
      for (const member of membersOf.get(other) ?? []) otherwise.add(member);
    }
    const partners = [...(membersOf.get(key) ?? [])].filter((w) => !otherwise.has(w));
    if (partners.length > 0) moved.push({ word, reading, key, partners });
  }
}

const population = [...new Set(moved.map((m) => m.word))].sort();
const pairs = new Set(moved.flatMap((m) => m.partners.map((p) => `${m.word}\t${p}`)));

console.log(`playable words the rule rewrites: ${rewritten.size}`);
console.log(`...of which gain a rhyme partner: ${population.length}`);
console.log(`new rhyme pairs, counted from the rewritten side: ${pairs.size}`);

// How concentrated the population is. A rule whose reach is one transcription
// repeated 900 times is not sampled meaningfully at 100 uniform draws, and a
// reader of the error rate has to be told which it is.
const byPartner = new Map<string, number>();
for (const word of population) {
  const all = new Set(moved.filter((m) => m.word === word).flatMap((m) => m.partners));
  for (const partner of all) byPartner.set(partner, (byPartner.get(partner) ?? 0) + 1);
}
const top = [...byPartner].sort((a, b) => b[1] - a[1]).slice(0, 8);
console.log("\nmost-reached partners (population words that gain each):");
for (const [partner, count] of top) {
  console.log(`  ${partner}: ${count} (${((count / population.length) * 100).toFixed(1)}%)`);
}

// A deterministic sample, so the same seed always draws the same 100 words.
let state = SEED >>> 0;
const random = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const shuffled = [...population];
for (let i = shuffled.length - 1; i > 0; i--) {
  const j = Math.floor(random() * (i + 1));
  [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
}
const drawn = shuffled.slice(0, Math.min(SAMPLE, shuffled.length));

// The partner shown is the best-known one available, so the row tests the
// sampled word's schwa rather than the judge's acquaintance with the partner.
const index = new RhymeIndex(data, { knownnessThreshold: 0 });
const knownness = (word: string) => index.tierOf(word).knownness ?? 0;
const partnerFor = (word: string) => {
  const all = new Set(moved.filter((m) => m.word === word).flatMap((m) => m.partners));
  return [...all].sort((a, b) => knownness(b) - knownness(a) || a.localeCompare(b))[0]!;
};

const rows = drawn
  .map((word) => ({ word, partner: partnerFor(word) }))
  .sort((a, b) => a.word.localeCompare(b.word));

const table = [
  "| # | does this word | rhyme with this one | yes / no |",
  "| --: | --- | --- | --- |",
  ...rows.map((r, i) => `| ${i + 1} | ${r.word} | ${r.partner} |  |`),
].join("\n");

if (OUT) {
  writeFileSync(resolve(root, OUT), `${table}\n`);
  console.log(`\nwrote ${rows.length} rows to ${OUT}`);
} else {
  console.log(`\n${table}`);
}
