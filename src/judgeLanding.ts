/**
 * The Judge's landing step (#266): what a ruling writes, once per Candidate. It
 * is ADR-0017's table made to act, and one module serves every caller that
 * lands a ruling: the `judge` command now, a Batch and the Appeals job later
 * (ADR-0021). Like `judge.ts` it calls no model and writes no file. It says
 * what to write, and the caller in `scripts/` writes it.
 *
 * ## What lands
 *
 * `classifyRuling` decides what a ruling earns, and this module turns that into
 * text for three committed files:
 *
 *   - a reading in `data/supplement.dict`, for a Missing Reading ruled a Rhyme
 *     at high confidence (ADR-0011, amended 2026-10-14);
 *   - an Unconfirmed Rhyme in `data/unconfirmed-rhymes.txt`, for a Missing
 *     Reading at medium confidence or an Overrule at high, unless the word is a
 *     scheduled Seed Word, which is never listed (ADR-0012 amended);
 *   - a ruling record in `data/judge-rulings.jsonl`, for every Candidate the
 *     Judge ruled on, whatever it earned.
 *
 * A suggested Demotion writes nothing but its record: making the Demotion is the
 * editor's act (ADR-0017 amended), and the record is where the Editor's Pass
 * reads the reason from.
 *
 * ## Once per Candidate
 *
 * The record is what keeps a Candidate from being sent twice. The Judge's ruling
 * on a pair is steady and not fixed, so a pair re-sent would in time be written
 * on a ruling that came up once: `mow` for `eyebrow` is no Rhyme, and one run of
 * five ruled it one. One run decides. What could not be read is no ruling, so it
 * is not recorded and is sent again.
 */

import { normaliseWord } from "./cmudict.ts";
import {
  phonemesOf,
  type Classification,
  type Confidence,
  type RhymeRuling,
  type WhatTheGameKnew,
  type WordhoodRuling,
} from "./judge.ts";
import type { RhymeKey } from "./phonology.ts";
import type { UnconfirmedRhyme } from "./unconfirmedRhymes.ts";

/** What one ruling wrote. A suggested Demotion writes only its record. */
export type Landed = "reading" | "unconfirmed-rhyme" | "suggested-demotion" | "nothing";

/** One line of `data/judge-rulings.jsonl`: a Candidate the Judge ruled on, and what landed. */
export interface JudgeRulingRecord {
  /** The day of the run that ruled, in the maintainer's time zone. */
  date: string;
  word: string;
  rhymeKey: RhymeKey;
  /** The Seed Word it was typed for. The pair is the word and the key, and this is context. */
  seedWord: string;
  /** The exact model id that ruled. */
  model: string;
  knew: WhatTheGameKnew;
  verdict: "rhyme" | "no-rhyme";
  /** The reading the Judge heard, as it wrote it. */
  reading: string | null;
  confidence: Confidence;
  why: string;
  /** The wordhood question's answer, asked only of a ruling that would act. */
  wordhood?: { verdict: "word" | "name" | "not-a-word"; confidence: Confidence; why: string };
  landed: Landed;
  /** Why a ruling that earned an Unconfirmed Rhyme wrote nothing. */
  heldBack?: "scheduled-seed-word";
}

/** One Candidate as the Judge's leg returns it. */
export interface RuledCandidate {
  word: string;
  seedWord: string;
  rhymeKey: RhymeKey;
  ruling: RhymeRuling;
  wordhood?: WordhoodRuling;
  /** Absent for a Candidate the Judge was not asked about. */
  classification?: Classification;
}

const pair = (word: string, rhymeKey: RhymeKey) => `${normaliseWord(word)} ${rhymeKey}`;

/** The pairs already ruled on, each with the record that ruled it. */
export function ruledPairs(records: readonly JudgeRulingRecord[]): Map<string, JudgeRulingRecord> {
  return new Map(records.map((r) => [pair(r.word, r.rhymeKey), r]));
}

/**
 * Which Candidates go to the Judge: each pair once, and none already ruled on.
 * A Candidate the Judge would not be asked about stays in `send`, so the caller
 * can report it set aside.
 */
export function planJudging<T extends { word: string; rhymeKey: RhymeKey }>(
  candidates: readonly T[],
  records: readonly JudgeRulingRecord[],
): { send: T[]; ruledBefore: { candidate: T; record: JudgeRulingRecord }[] } {
  const ruled = ruledPairs(records);
  const seen = new Set<string>();
  const send: T[] = [];
  const ruledBefore: { candidate: T; record: JudgeRulingRecord }[] = [];
  for (const candidate of candidates) {
    const key = pair(candidate.word, candidate.rhymeKey);
    const record = ruled.get(key);
    if (record) ruledBefore.push({ candidate, record });
    else if (!seen.has(key)) send.push(candidate);
    seen.add(key);
  }
  return { send, ruledBefore };
}

/** A reading for `data/supplement.dict`, with the line that says who wrote it. */
export interface WrittenReading {
  word: string;
  phonemes: string[];
  note: string;
}

export interface Landings {
  /** One per Candidate ruled, in the order given. */
  records: JudgeRulingRecord[];
  readings: WrittenReading[];
  unconfirmedRhymes: UnconfirmedRhyme[];
}

export interface LandingContext {
  date: string;
  model: string;
  /** Every scheduled Seed Word, none of which is ever listed as an Unconfirmed Rhyme. */
  scheduledSeeds: ReadonlySet<string>;
}

/**
 * What each ruling writes. A Candidate the Judge was not asked about writes
 * nothing and is not recorded; nor is one whose reply could not be read. The
 * wordhood question must have been asked of every ruling that would act.
 */
export function land(candidates: readonly RuledCandidate[], ctx: LandingContext): Landings {
  const out: Landings = { records: [], readings: [], unconfirmedRhymes: [] };
  const done = new Set<string>();
  for (const c of candidates) {
    const cl = c.classification;
    if (!cl || c.ruling.verdict === "no-ruling" || c.wordhood?.verdict === "no-ruling") continue;
    if (cl.needsWordhood) throw new Error(`${c.word} for ${c.seedWord} would act, and the wordhood question was not asked`);
    const key = pair(c.word, c.rhymeKey);
    if (done.has(key)) continue;
    done.add(key);

    const word = normaliseWord(c.word);
    let landed: Landed = "nothing";
    let heldBack: JudgeRulingRecord["heldBack"];
    if (cl.lands === "reading") {
      landed = "reading";
      out.readings.push({
        word,
        phonemes: phonemesOf(c.ruling.reading)!,
        note: `# ${word} (#266): no reading upstream; the Judge (${ctx.model}, ${ctx.date}) ruled it a Rhyme for \`${c.seedWord}\` on ${c.rhymeKey} at high confidence.`,
      });
    } else if (cl.lands === "unconfirmed-rhyme" && ctx.scheduledSeeds.has(word)) {
      heldBack = "scheduled-seed-word";
    } else if (cl.lands === "unconfirmed-rhyme") {
      landed = "unconfirmed-rhyme";
      out.unconfirmedRhymes.push({ word, rhymeKey: c.rhymeKey, writer: `judge:${ctx.model}`, ruling: cl.knew, confidence: cl.confidence });
    } else if (cl.lands === "demotion") {
      landed = "suggested-demotion";
    }

    out.records.push({
      date: ctx.date,
      word,
      rhymeKey: c.rhymeKey,
      seedWord: c.seedWord,
      model: ctx.model,
      knew: cl.knew,
      verdict: c.ruling.verdict,
      reading: c.ruling.reading,
      confidence: c.ruling.confidence,
      why: c.ruling.why,
      ...(c.wordhood ? { wordhood: { verdict: c.wordhood.verdict, confidence: c.wordhood.confidence, why: c.wordhood.why } } : {}),
      landed,
      ...(heldBack ? { heldBack } : {}),
    });
  }
  return out;
}

// ---- the files -----------------------------------------------------------------

/** The section of `data/supplement.dict` the Judge's readings go under, written once. */
export const JUDGE_SECTION =
  "# --- Adds by the Judge: a Missing Reading ruled a Rhyme at high confidence, its\n" +
  "# reading reaching the Rhyme Key and the word found to be a word (ADR-0011,\n" +
  "# amended 2026-10-14). Written with nobody reviewing them; see data/judge-runs/. ---";

/** The text to append to `data/supplement.dict` for these readings, given what it holds now. */
export function supplementAppend(existing: string, readings: readonly WrittenReading[]): string {
  if (readings.length === 0) return "";
  const section = existing.includes(JUDGE_SECTION) ? "" : `\n${JUDGE_SECTION}\n`;
  const sep = existing === "" || existing.endsWith("\n") ? "" : "\n";
  return `${sep}${section}${readings.map((r) => `${r.note}\n${r.word} ${r.phonemes.join(" ")}\n`).join("")}`;
}

/** One record as a line of JSON. */
export function serialiseRulingRecord(record: JudgeRulingRecord): string {
  return `${JSON.stringify(record)}\n`;
}

const LANDED = new Set<string>(["reading", "unconfirmed-rhyme", "suggested-demotion", "nothing"]);

/**
 * Read the record back. A line that does not read is dropped and reported, as
 * `data/unconfirmed-rhymes.txt` drops one: the file is written by an unattended
 * job, and a run that refused over one bad line would stay broken. A dropped
 * line costs one Candidate a second ruling, nothing more.
 */
export function parseRulingRecords(text: string): { records: JudgeRulingRecord[]; malformed: string[] } {
  const records: JudgeRulingRecord[] = [];
  const malformed: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    let got: unknown;
    try {
      got = JSON.parse(line);
    } catch {
      malformed.push(line);
      continue;
    }
    const r = got as Partial<JudgeRulingRecord> | null;
    if (!r || typeof r.word !== "string" || typeof r.rhymeKey !== "string" || !LANDED.has(r.landed as string)) {
      malformed.push(line);
      continue;
    }
    records.push(r as JudgeRulingRecord);
  }
  return { records, malformed };
}
