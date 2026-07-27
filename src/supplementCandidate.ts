/**
 * A play-testing candidate for the pronunciation supplement (ADR-0009): a word a
 * maintainer flagged mid-play as *should have been accepted*, captured with the
 * context a judge needs to act on it later. The capture side (a dev-only button →
 * dev-server endpoint) only records; the judging — is this a real word, an add or
 * a stress correction, what reading — happens on a later run against this queue.
 *
 * The queue is append-only JSON Lines (`data/supplement-candidates.jsonl`, a
 * scratch file, gitignored with the rest of `data/`), so a session can jot many
 * candidates and none is lost to a crash. This module is the pure record shape
 * and its (de)serialisation; the IO and the judging live elsewhere.
 */

import type { RejectionReason } from "./verdict.ts";

export interface SupplementCandidate {
  /** The submission the maintainer thinks should have counted. */
  word: string;
  /** The Seed Word it was played against — what it must rhyme with. */
  seedWord: string;
  /** The Seed's pinned Rhyme Key — the target the judge authors stress toward. */
  seedRhymeKey: string;
  /** Why the engine rejected it — the judge's first hint at add vs correction. */
  reason: RejectionReason;
  /**
   * For a `does-not-rhyme` rejection, the reading the engine used (respelled), so
   * the judge can see which stress it must correct. Null for the other reasons.
   */
  engineRespelling: string | null;
  /** When it was flagged (ISO 8601). */
  timestamp: string;
}

/** Serialise one candidate to a single JSON Lines record (newline included). */
export function serialiseCandidate(candidate: SupplementCandidate): string {
  return JSON.stringify(candidate) + "\n";
}

/**
 * Parse a JSON Lines queue into candidates. Blank lines are skipped, and a line
 * that isn't a well-formed candidate is dropped rather than throwing — one
 * corrupt jot must never block judging the rest of a session's queue.
 */
export function parseCandidates(text: string): SupplementCandidate[] {
  const out: SupplementCandidate[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (isCandidate(parsed)) out.push(parsed);
  }
  return out;
}

function isCandidate(value: unknown): value is SupplementCandidate {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.word === "string" &&
    typeof c.seedWord === "string" &&
    typeof c.seedRhymeKey === "string" &&
    typeof c.reason === "string" &&
    typeof c.timestamp === "string"
  );
}
