/**
 * PROTOTYPE, throwaway (#231). Builds the pool of pairs a judge would be asked
 * to rule on, and splits it into the blind held-out set and the tuning pool.
 *
 *   npx tsx scripts/judge.prototype/pool.ts
 *
 * Writes pool.json and heldout.json beside this file. Deterministic: the same
 * inputs give the same held-out set, so re-running never reshuffles it.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCmudict } from "../../src/cmudict.ts";
import { bareSound, isVowel, isVowelSound, rhymeKeyOf, type Pronunciation, type RhymeKey } from "../../src/phonology.ts";
import { respell } from "../../src/respelling.ts";
import { deserialise, type SerialisedIndex } from "../../src/serialise.ts";
import { parseCandidates } from "../../src/supplementCandidate.ts";
import { evidenceContextFrom, gatherEvidence, type EvidenceContext } from "../../src/supplementEvidence.ts";
import { parseTierOverrides } from "../../src/tierOverride.ts";
import { pinnedEvidenceContext } from "../editorAdd.ts";

const here = import.meta.dirname;
const root = resolve(here, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const lines = (p: string) => new Set(read(p).split(/\r?\n/).map((w) => w.trim().toLowerCase()).filter(Boolean));

const manifest = JSON.parse(read("dist-data/index.manifest.json"));
const index = deserialise(JSON.parse(read(`dist-data/${manifest.index}`)) as SerialisedIndex);
const schedule = JSON.parse(read("data/schedule.json"));
const seedForKey = new Map<RhymeKey, string>(schedule.days.map((d: { rhymeKey: string; seed: string }) => [d.rhymeKey, d.seed]));

/** The engine as it reads today, and as it read before any hand correction. */
const ctxNow = pinnedEvidenceContext();
const ctxBefore = evidenceContextFrom({
  pronunciations: parseCmudict(read("data/cmudict.dict")),
  words: lines("data/words.txt"),
  names: lines("data/names.txt"),
});

export type Kind = "no-reading" | "wrong-reading" | "stress" | "no-wordhood" | "tier";
export type Label = "rhymes" | "weak" | "no-rhyme" | "not-a-word" | "answer" | "bonus" | "unsure";

export interface Evidence {
  isWord: boolean;
  isName: boolean;
  /** The word's own readings, ARPAbet, with the Rhyme Key each one gives. */
  readings: { phonemes: string; key: string | null; respelling: string }[];
  relatives: { word: string; readings: string[]; rhymes: boolean }[];
  composed: { phonemes: string; head: string; tail: string } | null;
}

export interface Pair {
  id: string;
  word: string;
  seedWord: string;
  rhymeKey: RhymeKey;
  seedReading: string | null;
  seedRespelling: string | null;
  kind: Kind;
  source: "appeal" | "synthetic" | "supplement" | "tier-override";
  /** How many Synthetic Player runs produced it (0 for other sources). */
  producedBy: number;
  evidence: Evidence;
  /** A ruling already on file, where there is one. */
  onFile?: Label;
}

const sounds = (p: Pronunciation) => p.map(bareSound).join(" ");

/** ADR-0020's mechanical test: same final-syllable sounds, stress falling earlier. */
function isWeak(reading: Pronunciation, key: RhymeKey): boolean {
  if (key.split(" ").filter(isVowelSound).length !== 1) return false;
  if (rhymeKeyOf(reading) === key) return false;
  let last = -1;
  reading.forEach((p, i) => { if (isVowel(p)) last = i; });
  return last >= 0 && sounds(reading.slice(last)) === key;
}

function seedReading(seedWord: string, key: RhymeKey): Pronunciation | null {
  return (ctxNow.pronunciations.get(seedWord) ?? []).find((p) => rhymeKeyOf(p) === key) ?? null;
}

function evidenceOf(word: string, key: RhymeKey, ctx: EvidenceContext): Evidence {
  const ev = gatherEvidence(word, key, ctx);
  return {
    isWord: ev.isWord,
    isName: ev.isName,
    readings: ev.direct.map((r) => ({ phonemes: r.phonemes.join(" "), key: r.key, respelling: respell(r.phonemes) })),
    relatives: ev.relatives.map((r) => ({ word: r.word, readings: r.readings.map((x) => x.phonemes.join(" ")), rhymes: r.rhymes })),
    composed: ev.composed
      ? { phonemes: ev.composed.phonemes.join(" "), head: ev.composed.head.word, tail: ev.composed.tail.word }
      : null,
  };
}

/** Which question the engine's state poses, or null when it already accepts the pair. */
function kindOf(ev: Evidence, key: RhymeKey): Kind | null {
  const reaches = ev.readings.some((r) => r.key === key);
  if (reaches) return ev.isWord ? null : "no-wordhood";
  if (ev.readings.length === 0) return "no-reading";
  return ev.readings.some((r) => isWeak(r.phonemes.split(" "), key)) ? "stress" : "wrong-reading";
}

const pool = new Map<string, Pair>();
function add(word: string, seedWord: string, key: RhymeKey, source: Pair["source"], ctx: EvidenceContext, onFile?: Label) {
  const id = `${word}|${key}`;
  const existing = pool.get(id);
  if (existing) { if (source === "synthetic") existing.producedBy++; return; }
  if (word === seedWord || !/^[a-z]+$/.test(word)) return;
  const evidence = evidenceOf(word, key, ctx);
  const kind = kindOf(evidence, key);
  if (kind === null) return;
  const sr = seedReading(seedWord, key);
  pool.set(id, {
    id, word, seedWord, rhymeKey: key,
    seedReading: sr?.join(" ") ?? null, seedRespelling: sr ? respell(sr) : null,
    kind, source, producedBy: source === "synthetic" ? 1 : 0, evidence, ...(onFile ? { onFile } : {}),
  });
}

/** A Seed Word to pair a bare word with: the scheduled one, else the best-known family member. */
function seedFor(key: RhymeKey, not: string): string | null {
  const scheduled = seedForKey.get(key);
  if (scheduled && scheduled !== not) return scheduled;
  const members = index.familyOf(key).members.filter((m) => m.word !== not && m.tier === "answer");
  members.sort((a, b) => (b.knownness ?? 0) - (a.knownness ?? 0) || a.word.localeCompare(b.word));
  return members[0]?.word ?? null;
}

// 1. Every hand-written reading is a "rhymes" on file, judged against the engine as it was before.
for (const line of read("data/supplement.dict").split(/\r?\n/)) {
  const text = line.replace(/#.*/, "").trim();
  if (!text) continue;
  const [word, ...phonemes] = text.split(/\s+/);
  const key = index.rhymeKeysOf(word!).find((k) => k === rhymeKeyOf(phonemes)) ?? index.rhymeKeysOf(word!)[0];
  const seedWord = key && seedFor(key, word!);
  if (key && seedWord) add(word!, seedWord, key, "supplement", ctxBefore, "rhymes");
}

// 2. Real Appeals. One the engine accepts today was ruled "rhymes"; the rest are unruled.
for (const c of parseCandidates(read("data/supplement-candidates.jsonl"))) {
  if (c.reason === "already-submitted") continue;
  const now = gatherEvidence(c.word, c.seedRhymeKey, ctxNow);
  if (now.rhymesDirectly && now.isWord) add(c.word, c.seedWord, c.seedRhymeKey, "appeal", ctxBefore, "rhymes");
  else add(c.word, c.seedWord, c.seedRhymeKey, "appeal", ctxNow);
}

// 3. What the Synthetic Player typed and the engine refused, plus what it scored only as a Bonus Word.
const runDir = resolve(root, ".scratch/synthetic-player");
const overrides = new Map(parseTierOverrides(read("data/tier-overrides.csv")).map((r) => [r.word, r.verdict]));
for (const file of readdirSync(runDir).filter((f) => f.endsWith(".json")).sort()) {
  const seedWord = file.split(".")[0]!;
  const day = schedule.days.find((d: { seed: string }) => d.seed === seedWord);
  let seed;
  try { seed = index.pinSeed(seedWord, day?.rhymeKey); } catch { continue; }
  const run = JSON.parse(readFileSync(resolve(runDir, file), "utf8")) as { words: string[] };
  for (const word of new Set(run.words)) {
    const verdict = index.adjudicate(seed, word);
    if (verdict.outcome === "rejected") {
      if (verdict.reason === "is-the-seed-word" || verdict.reason === "malformed") continue;
      add(word, seed.word, seed.rhymeKey, "synthetic", ctxNow);
    } else if (verdict.outcome === "bonus") {
      const id = `${word}|tier`;
      const existing = pool.get(id);
      if (existing) { existing.producedBy++; continue; }
      const ruled = overrides.get(word);
      pool.set(id, {
        id, word, seedWord: seed.word, rhymeKey: seed.rhymeKey, seedReading: null, seedRespelling: null,
        kind: "tier", source: "synthetic", producedBy: 1,
        evidence: evidenceOf(word, seed.rhymeKey, ctxNow),
        ...(ruled === "bonus" ? { onFile: "bonus" as const } : {}),
      });
    }
  }
}

// ---- split ---------------------------------------------------------------

/** mulberry32, seeded, so the held-out set is the same on every run. */
function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = prng(231);
const shuffled = <T>(xs: T[]) => xs.map((x) => [rand(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);

const QUOTA: Record<Kind, number> = { "no-reading": 70, "wrong-reading": 60, stress: 30, "no-wordhood": 15, tier: 25 };
const PER_KEY_CAP = 10;

const all = [...pool.values()].sort((a, b) => a.id.localeCompare(b.id));
const unruled = all.filter((p) => !p.onFile);
const heldout: Pair[] = [];
for (const kind of Object.keys(QUOTA) as Kind[]) {
  const perKey = new Map<string, number>();
  for (const p of shuffled(unruled.filter((x) => x.kind === kind))) {
    if (heldout.filter((h) => h.kind === kind).length >= QUOTA[kind]) break;
    const n = perKey.get(p.rhymeKey) ?? 0;
    if (n >= PER_KEY_CAP) continue;
    perKey.set(p.rhymeKey, n + 1);
    heldout.push(p);
  }
}
const heldoutIds = new Set(heldout.map((p) => p.id));

writeFileSync(resolve(here, "pool.json"), JSON.stringify(all.filter((p) => !heldoutIds.has(p.id)), null, 1));
writeFileSync(resolve(here, "heldout.json"), JSON.stringify(shuffled(heldout), null, 1));

const tally = (ps: Pair[], f: (p: Pair) => string) => {
  const t: Record<string, number> = {};
  for (const p of ps) t[f(p)] = (t[f(p)] ?? 0) + 1;
  return t;
};
console.log("pool", all.length);
console.log(" on file  ", tally(all.filter((p) => p.onFile), (p) => `${p.kind}:${p.onFile}`));
console.log(" unruled  ", tally(unruled, (p) => `${p.kind}/${p.source}`));
console.log("held out", heldout.length, tally(heldout, (p) => p.kind), "keys", new Set(heldout.map((p) => p.rhymeKey)).size);
