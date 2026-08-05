/**
 * The Session's serialisation, beside the Session it mirrors — what `serialise.ts`
 * is to the Rhyme Index. The format is the engine's business; the transport is
 * not. Nothing here reads or writes storage: the module is string-in, string-out,
 * and the web shell's session hook is the only thing that touches
 * `localStorage`.
 */

import type { RhymeIndex, SeedWord } from "./rhymeIndex.ts";
import { Session } from "./session.ts";

/**
 * A Session plus the log the Session deliberately does not keep.
 *
 * `PlayState` records what a player *found*; it records nothing about a
 * Submission that was refused, because a refusal changes no state. Healing needs
 * the refusals — a word rejected on Monday can only start counting on Wednesday
 * if it was written down — so the raw Submissions travel alongside the Session
 * rather than inside it. That is why `Session`'s own interface is unchanged.
 */
export interface PersistedSession {
  session: Session;
  /** Every Submission as typed, in order, accepted or rejected. */
  submissions: readonly string[];
}

/**
 * The stored shape, versioned explicitly — deliberately unlike the index
 * artifact, which is produced and consumed by the same deploy. A snapshot is
 * written by yesterday's build and read by today's, so the reader has to be able
 * to recognise a format it does not know and discard it.
 */
const VERSION = 1;

/** Namespaced so the key cannot collide with anything else the origin stores. */
const KEY_PREFIX = "rhyme-bee:session:";

/**
 * Where a day's snapshot lives. It derives from the schedule date and from
 * nothing else, so the writer and the reader cannot disagree about the address —
 * and each day is its own address, which is what keeps yesterday's Session out
 * of today's Puzzle.
 *
 * Only the daily Puzzle has one. A free-play Seed is drawn at random and has no
 * stable date to key on, so a free-play Session is not persisted at all.
 */
export function snapshotKey(date: string): string {
  return `${KEY_PREFIX}${date}`;
}

export function snapshot(persisted: PersistedSession, meta: { date: string }): string {
  const { session, submissions } = persisted;
  return JSON.stringify({
    version: VERSION,
    date: meta.date,
    seed: { word: session.seed.word, rhymeKey: session.seed.rhymeKey },
    submissions: [...submissions],
    ended: session.ended,
  });
}

/** The stored shape, once it has been recognised as one. */
interface StoredSnapshot {
  version: number;
  date: string;
  seed: { word: string; rhymeKey: string };
  submissions: string[];
  ended: boolean;
}

/**
 * Rebuild a Session from a snapshot by replaying its Submissions through the
 * *current* judge, so the shipped index is always authoritative and a stored
 * verdict can never contradict a rebuilt one.
 *
 * Total by construction: absent, empty, non-JSON, truncated, unknown-version,
 * wrong-shape and Seed-mismatched input all collapse to a fresh Session on the
 * Seed given, so the caller never branches on failure. A snapshot is written by
 * yesterday's build and read by today's, and every one of those is a thing that
 * genuinely happens to storage a player's browser owns.
 */
export function resume(index: RhymeIndex, seed: SeedWord, raw: string | null): PersistedSession {
  const stored = parse(raw);
  // A Seed mismatch is not corruption — it is yesterday's Session found under
  // today's key, or a snapshot pinned to the other reading of an ambiguous Seed.
  // Replaying it would build a Puzzle the player never saw, so it is discarded.
  if (
    stored === null ||
    stored.seed.word !== seed.word ||
    stored.seed.rhymeKey !== seed.rhymeKey
  ) {
    return replay(index, seed, [], false);
  }
  return replay(index, seed, stored.submissions, stored.ended);
}

/** The snapshot this string holds, or null if it does not hold one. */
function parse(raw: string | null): StoredSnapshot | null {
  if (raw === null || raw === "") return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<StoredSnapshot>;

  if (candidate.version !== VERSION) return null;
  if (typeof candidate.date !== "string") return null;
  if (typeof candidate.ended !== "boolean") return null;
  if (!Array.isArray(candidate.submissions)) return null;
  if (!candidate.submissions.every((word) => typeof word === "string")) return null;

  const seed = candidate.seed;
  if (typeof seed !== "object" || seed === null) return null;
  if (typeof seed.word !== "string" || typeof seed.rhymeKey !== "string") return null;

  return {
    version: candidate.version,
    date: candidate.date,
    seed: { word: seed.word, rhymeKey: seed.rhymeKey },
    submissions: candidate.submissions,
    ended: candidate.ended,
  };
}

function replay(
  index: RhymeIndex,
  seed: SeedWord,
  submissions: readonly string[],
  ended: boolean,
): PersistedSession {
  let session = Session.start(index, seed);
  // The result of each Submission is discarded on purpose: replay reconstructs
  // state, and a resuming player must not be shown a burst of stale verdicts.
  for (const word of submissions) session = session.submit(word).session;
  // Ending last, because an ended Session declines every Submission.
  if (ended) session = session.end();
  return { session, submissions: [...submissions] };
}
