/**
 * The Tier sitting (#309, under #307): two commands over `src/tierSitting.ts`.
 *
 *   npm run tier:draw -- [--set tier-1] [--labeller jkenna] [--out dist/tier-sitting.html]
 *     Draws the sample from the scheduled days' Puzzles in the built index and
 *     writes the marking page. The same build draws the same sample.
 *
 *   npm run tier:place -- [--set tier-1] [--labeller jkenna] [--file <marks.json>]
 *     Reads `data/judge-labels/<set>.json` (or `--file`), places both lines, compares the
 *     signals and reports what the placed lines would do to the Schedule.
 *
 * Both only read: nothing in the built index or the Schedule changes.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DEFAULT_PLAYABLE_BAND, playableSeeds } from "../src/curation.ts";
import { parseLabelSet } from "../src/judgeLabels.ts";
import { loadRhymeIndex } from "../src/loader.ts";
import { parsePrevalenceCsv } from "../src/pipeline.ts";
import { splitFamily, type RhymeIndex } from "../src/rhymeIndex.ts";
import { parseSchedule } from "../src/schedule.ts";
import { DEFAULT_SCORING_CONFIG } from "../src/scoring.ts";
import { testSeedWord } from "../src/seedWord.ts";
import {
  bandEdge,
  bandOf,
  compareSignals,
  consequencesAt,
  DEFAULT_DRAW,
  drawSample,
  marksOf,
  measured,
  placeLines,
  REPLACE_DAY_UNDER,
  type DayAtLines,
  type Lines,
  type MarkedWord,
  type PoolFamily,
  type SittingDay,
  unscheduledPool,
} from "../src/tierSitting.ts";
import { indexArtifactPath, readIndexManifest } from "./indexArtifact.ts";
import { sittingDays } from "./sittingDays.ts";
import { sittingPage } from "./tierSittingPage.ts";

const root = resolve(import.meta.dirname, "..");
const distData = resolve(root, "dist-data");

function flag(args: string[], name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
}

function loadIndex(): { index: RhymeIndex; hash: string } {
  const manifest = readIndexManifest(distData);
  if (!manifest) throw new Error("no built index in dist-data/: run npm run build:index");
  return { index: loadRhymeIndex(indexArtifactPath(distData)), hash: manifest.hash };
}

/** Every scheduled day with the Answers its Puzzle holds in the built index. */
function scheduledDays(index: RhymeIndex): SittingDay[] {
  const schedule = parseSchedule(JSON.parse(readFileSync(resolve(root, "data/schedule.json"), "utf8")));
  if (!schedule) throw new Error("data/schedule.json does not read as a Schedule");
  return sittingDays(index, schedule.days);
}

/**
 * The Seed pool's families whose Seed Word passes the Seed Word test, each with
 * its Answers read off the built index for measuring. Scheduled or not:
 * `unscheduledPool` is the filter that keeps only those holding no place.
 */
function passingPoolFamilies(index: RhymeIndex): PoolFamily[] {
  const families = index.families();
  return playableSeeds(index)
    .filter((f) => testSeedWord(index, f.representative, f.rhymeKey).passes)
    .map((f) => ({
      seedWord: f.representative,
      rhymeKey: f.rhymeKey,
      seedKnownness: index.tierOf(f.representative).knownness,
      answers: splitFamily(families.get(f.rhymeKey)!, f.representative).answers.map((a) => ({ word: a.word, length: a.length, knownness: a.knownness })),
    }));
}

function draw(args: string[]) {
  const set = flag(args, "set", "tier-1");
  const labeller = flag(args, "labeller", "jkenna");
  const out = resolve(root, flag(args, "out", "dist/tier-sitting.html"));
  const { index, hash } = loadIndex();
  const items = drawSample(scheduledDays(index));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, sittingPage({ set, labeller, indexHash: hash, draw: DEFAULT_DRAW, items }));
  // Counted here, in the terminal, and never on the page.
  const perBand = new Map<number, number>();
  for (const item of items) {
    const band = bandOf(index.tierOf(item.word).knownness!, DEFAULT_DRAW.bands)!;
    perBand.set(band, (perBand.get(band) ?? 0) + 1);
  }
  console.log(`drew ${items.length} Answers from index ${hash} (seed ${DEFAULT_DRAW.seed})`);
  console.log(`per band: ${[...perBand].sort((a, b) => a[0] - b[0]).map(([b, n]) => `${bandEdge(b, DEFAULT_DRAW.bands).toFixed(2)}:${n}`).join("  ")}`);
  console.log(`page: ${out}\nsave the marks as data/judge-labels/${set}.json, then: npm run tier:place -- --set ${set}`);
}

const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : x > 0 ? "above all" : "none");
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const dayLine = (d: DayAtLines) => `${d.date} ${d.seedWord} (${d.answerCount} Answers, Difficulty ${d.difficulty.toFixed(3)})`;

function place(args: string[]) {
  const name = flag(args, "set", "tier-1");
  const file = resolve(root, flag(args, "file", `data/judge-labels/${name}.json`));
  const set = parseLabelSet(JSON.parse(readFileSync(file, "utf8")));
  const labeller = flag(args, "labeller", set.labelledBy[0] ?? "");
  const { index, hash } = loadIndex();
  const frequency = parsePrevalenceCsv(readFileSync(resolve(root, "data/prevalence.csv"), "utf8"), "FreqZipfUS");

  const marks: MarkedWord[] = [];
  const skipped: string[] = [];
  for (const m of marksOf(set, labeller)) {
    const knownness = index.tierOf(m.word).knownness;
    if (!measured(knownness)) {
      skipped.push(m.word);
      continue;
    }
    // Frequency is read through the very word the index read knownness from, so the two signals describe the same word.
    const stem = index.knownStemOf(m.word) ?? m.word;
    marks.push({ word: m.word, knownness, frequency: frequency.get(stem) ?? null, mark: m.mark });
  }

  const days = scheduledDays(index);
  const today: Lines = { answerLine: index.knownnessThreshold, rareLine: DEFAULT_SCORING_CONFIG.rareKnownnessCutoff };
  const placed = placeLines({ days, today }, marks);
  const signals = compareSignals(marks);

  console.log(`Tier sitting ${set.set}: ${marks.length} marks by ${labeller}, placed on index ${hash}`);
  if (skipped.length) console.log(`  left out, as they carry no measured knownness now: ${skipped.join(", ")}`);
  console.log("\nband     E   H   B");
  for (const b of placed.bands) console.log(`${b.from.toFixed(2).padStart(4)}  ${String(b.easy).padStart(3)} ${String(b.hardFind).padStart(3)} ${String(b.bonus).padStart(3)}`);

  console.log(`\nAnswer line: ${placed.answerLine === null ? "not placed: the highest band is half or more B" : placed.answerLine.toFixed(2)}`);
  console.log(`rare line: ${placed.rareLine === null ? "not placed: no band at or above the Answer line has an E majority" : placed.rareLine.toFixed(2)}`);
  console.log("  (looked for only at or above the Answer line: a band below it holds no Answers to be rare, so an E majority there places nothing)");
  console.log(`rare line keeping today's rare share (${pct(placed.rareShare)} of Answers): ${placed.rareShareLine.toFixed(3)}`);
  console.log(`measured below at: Answer line ${placed.inForce.answerLine.toFixed(2)}, rare line ${placed.inForce.rareLine.toFixed(3)}`);

  console.log("\nseparating B from E and H (best single cut; share of marks it agrees with in sample, and held out one at a time):");
  const scores = (s: { agreement: number; heldOut: number }) => `${pct(s.agreement)} in sample, ${pct(s.heldOut)} held out`;
  const margin = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} points`;
  console.log(`  knownness alone: B below ${f2(signals.knownness.cut)}: ${scores(signals.knownness)}`);
  console.log(`  frequency alone: B below ${f2(signals.frequency.cut)}: ${scores(signals.frequency)}`);
  console.log(`  knownness minimum ${f2(signals.combined.knownnessMinimum)}, frequency above it below ${f2(signals.combined.frequencyCut)}: ${scores(signals.combined)}`);
  console.log(`  combined minus knownness: ${margin(signals.combinedOverKnownness.agreement)} in sample, ${margin(signals.combinedOverKnownness.heldOut)} held out`);
  console.log("  (the combined signal holds every knownness cut, so in sample it cannot lose; read the held-out margin)");

  const pool = unscheduledPool(passingPoolFamilies(index), days);
  const before = consequencesAt(today, { days, pool });
  const at = consequencesAt(placed.inForce, { days, pool });
  console.log(`\nat the placed lines, across ${days.length} scheduled days:`);
  console.log(`  Answers that become Bonus Words: ${at.answersToBonus.length}; nearest the line: ${at.answersToBonus.slice(0, 30).map((c) => `${c.word} ${c.knownness.toFixed(2)}`).join(", ")}`);
  const list = (label: string, ds: DayAtLines[], was: DayAtLines[]) => {
    console.log(`  ${label}: ${ds.length} (today ${was.length})`);
    for (const d of ds.slice(0, 40)) console.log(`    ${dayLine(d)}`);
    if (ds.length > 40) console.log(`    and ${ds.length - 40} more`);
  };
  list(`days under ${DEFAULT_PLAYABLE_BAND.min} Answers, the size band's floor`, at.daysUnderBand, before.daysUnderBand);
  list(`days under ${REPLACE_DAY_UNDER} Answers, to replace`, at.daysToReplace, before.daysToReplace);
  console.log(`  Seed Words below the Answer line: ${at.seedWordsBelowLine.length}${at.seedWordsBelowLine.length ? ": " + at.seedWordsBelowLine.map((d) => `${d.seedWord} ${d.seedKnownness?.toFixed(2) ?? "unmeasured"}`).join(", ") : ""}`);
  list("days with Difficulty 0", at.difficultyZero, before.difficultyZero);
  console.log(`  weeks out of ramp order: ${at.weeksOutOfRamp.length} (today ${before.weeksOutOfRamp.length})${at.weeksOutOfRamp.length ? ": weeks " + at.weeksOutOfRamp.join(", ") : ""}`);
  console.log(`  replacement Seed Words for days under ${REPLACE_DAY_UNDER}, from the ${pool.length} unscheduled in the Seed pool (each still needs its Batch):${at.replacements.length ? "" : " no day needs one"}`);
  for (const r of at.replacements) console.log(`    ${r.date} ${r.seedWord}: ${r.candidates.join(", ") || "none big enough"}`);
}

const [command, ...rest] = process.argv.slice(2);
if (command === "draw") draw(rest);
else if (command === "place") place(rest);
else {
  console.error("usage: tsx scripts/tier-sitting.ts draw|place [--set tier-1] [--labeller jkenna] [--out dist/tier-sitting.html]");
  process.exit(1);
}
