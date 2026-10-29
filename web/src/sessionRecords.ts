/**
 * Sends a **Session Record** for every Daily Puzzle Session (ADR-0019, #230).
 *
 * One rule, called from two places: **on load and when the page is hidden, send
 * every stored Daily Puzzle Session that is new or has grown since it was last
 * sent.** That covers today's Session, a visitor who never returns, a refresh,
 * and the history every playtester's browser has held since 2026-08-06.
 *
 * It reads the snapshots `usePuzzleSession` writes and nothing else of the
 * game's, so it never touches play: the game never waits on it, the load's sends
 * wait for the Rhyme Index and idle time instead of competing with them, it holds
 * no React state, and every failure (storage blocked, the route down, the
 * limiter saying no) is swallowed. A Free Play or Tutorial Session is never
 * stored, so it is never found here to send.
 *
 * What it keeps of its own lives under one key, `RECORD_LEDGER_KEY`, beside the
 * snapshots rather than inside them, so the snapshot's stored format and its
 * `VERSION` are untouched (a reader that discarded old snapshots would throw away
 * both the history this exists to send and a player's Session in progress). Per
 * date it holds the Session's random id, made before the first send so a
 * response lost to the page closing cannot turn one Session into two records,
 * and what was last accepted. A Session is marked sent only when the route
 * accepted it, so whatever the limiter refuses goes on a later visit by itself.
 *
 * The rule is `createSessionRecordSender`, tested with a stand-in store and
 * route. `startSessionRecords` is the thin wiring to `localStorage`, `fetch` and
 * the page's events, untested on the principle `usePuzzleSession.ts` states.
 */

import { localCalendarDate } from "../../src/schedule.ts";
import { recordFromBody, type SessionRecord } from "../../src/sessionRecord.ts";
import { readSnapshot, snapshotDateOf } from "../../src/sessionSnapshot.ts";
import { SESSION_RECORD_PATH } from "./endpoints.ts";

/** Where the sender keeps its ids and what it last sent: a `rhyme-bee:` key of its own. */
export const RECORD_LEDGER_KEY = "rhyme-bee:session-records";

/** The slice of `localStorage` the sender uses. Any method may throw. */
export interface RecordStorage {
  keys(): string[];
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** Post one record's JSON. True only when the route accepted it; may throw. */
export type PostRecord = (body: string, init: { keepalive: boolean }) => Promise<boolean>;

export interface SenderOptions {
  /** False in a dev build, which sends nothing (ADR-0019). */
  enabled: boolean;
  storage: RecordStorage;
  post: PostRecord;
  /** The player's own calendar date. */
  today: () => string;
  /** The content hash of the Rhyme Index this build ships. */
  indexHash: string;
  /** A fresh random per-Session id: 32 lower-case hex digits. */
  newId: () => string;
}

export interface SessionRecordSender {
  /**
   * Send every stored Session that is new or has grown. `load` sends one at a
   * time and stops at the first refusal, so a history arrives at the limiter's
   * pace; `hide` sends everything at once, because nothing after the page goes
   * away can wait on a response.
   */
  flush(moment: "load" | "hide"): Promise<void>;
}

interface LedgerEntry {
  id: string;
  /** What the route last accepted, or absent when it has accepted nothing yet. */
  sent?: { submissions: number; ended: boolean };
}

type Ledger = Record<string, LedgerEntry>;

const ID_SHAPE = /^[0-9a-f]{32}$/;

function readLedger(storage: RecordStorage): Ledger {
  let value: unknown;
  try {
    value = JSON.parse(storage.get(RECORD_LEDGER_KEY) ?? "{}");
  } catch {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const ledger: Ledger = {};
  for (const [date, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as Partial<LedgerEntry>;
    if (typeof entry.id !== "string" || !ID_SHAPE.test(entry.id)) continue;
    const sent = entry.sent;
    ledger[date] =
      typeof sent === "object" &&
      sent !== null &&
      typeof sent.submissions === "number" &&
      typeof sent.ended === "boolean"
        ? { id: entry.id, sent: { submissions: sent.submissions, ended: sent.ended } }
        : { id: entry.id };
  }
  return ledger;
}

export function createSessionRecordSender(options: SenderOptions): SessionRecordSender {
  const { storage } = options;
  /** Dates with a send in flight, so a hide during the load's run sends nothing twice. */
  const inFlight = new Set<string>();

  function writeLedger(ledger: Ledger): void {
    storage.set(RECORD_LEDGER_KEY, JSON.stringify(ledger));
  }

  /** The records owed, today's first and then newest first. Gives each an id before it goes. */
  function owed(): SessionRecord[] {
    const ledger = readLedger(storage);
    const today = options.today();
    const records: SessionRecord[] = [];
    let changed = false;

    for (const key of storage.keys()) {
      const date = snapshotDateOf(key);
      if (date === null || inFlight.has(date)) continue;
      const stored = readSnapshot(storage.get(key));
      if (stored === null || stored.date !== date) continue;

      const entry = ledger[date];
      const sent = entry?.sent;
      if (sent && sent.submissions === stored.submissions.length && sent.ended === stored.ended) {
        continue;
      }

      const id = entry?.id ?? options.newId();
      const body = {
        id,
        date,
        seed: { word: stored.seed.word, rhymeKey: stored.seed.rhymeKey },
        submissions: stored.submissions,
        ended: stored.ended,
        ...(date === today ? { indexHash: options.indexHash } : {}),
      };
      // What the route would refuse is not sent at all: it would be refused on
      // every visit for ever, spending the limiter's budget on nothing.
      const checked = recordFromBody(body);
      if (!checked.ok) continue;

      if (entry === undefined) {
        ledger[date] = { id };
        changed = true;
      }
      records.push(checked.record);
    }

    // The id is written down before anything is sent, so a send whose response
    // never arrives is resent under the same id and overwrites, never duplicates.
    if (changed) writeLedger(ledger);
    return records.sort((a, b) =>
      a.date === today ? -1 : b.date === today ? 1 : b.date.localeCompare(a.date),
    );
  }

  async function send(record: SessionRecord, keepalive: boolean): Promise<boolean> {
    inFlight.add(record.date);
    try {
      const accepted = await options.post(JSON.stringify(record), { keepalive });
      if (accepted) {
        const ledger = readLedger(storage);
        ledger[record.date] = {
          id: record.id,
          sent: { submissions: record.submissions.length, ended: record.ended },
        };
        writeLedger(ledger);
      }
      return accepted;
    } catch {
      return false;
    } finally {
      inFlight.delete(record.date);
    }
  }

  return {
    async flush(moment) {
      if (!options.enabled) return;
      try {
        const records = owed();
        if (moment === "hide") {
          await Promise.all(records.map((record) => send(record, true)));
          return;
        }
        // Without keepalive: keepalive bodies share a 64 KB in-flight budget,
        // which a history this long would exceed, and the page is not going away.
        for (const record of records) {
          if (!(await send(record, false))) return;
        }
      } catch {
        // Storage blocked or full. A Session Record is reporting, and a failed
        // one costs the player nothing (ADR-0013).
      }
    },
  };
}

/** `localStorage`, behind the sender's interface. Every call may throw; the sender catches. */
const browserStorage: RecordStorage = {
  keys() {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key !== null) keys.push(key);
    }
    return keys;
  },
  get: (key) => window.localStorage.getItem(key),
  set: (key, value) => window.localStorage.setItem(key, value),
};

/**
 * `fetch`, with `keepalive` on the hide's sends so a send started as the page is
 * hidden outlives the page. Not `sendBeacon`, which reports no response, and a Session is marked
 * sent only on one.
 */
const postRecord: PostRecord = async (body, { keepalive }) => {
  const response = await fetch(SESSION_RECORD_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive,
  });
  return response.ok;
};

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Settles once the Rhyme Index has loaded, or failed to, and the page is next
 * idle: when the load's sends can start without competing with play for the
 * network or the main thread. Reading every stored snapshot is not free, and
 * "sending must never block, delay or change play" (#230).
 */
export async function afterIndexLoad(
  indexLoad: Promise<unknown>,
  idle: (run: () => void) => void,
): Promise<void> {
  await indexLoad.catch(() => undefined);
  await new Promise<void>((resolve) => idle(resolve));
}

/** `requestIdleCallback` where the browser has one, a short timeout where it does not. */
function browserIdle(run: () => void): void {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => run(), { timeout: 5000 });
  } else {
    setTimeout(run, 1000);
  }
}

/**
 * Send what is owed once play is under way, and again whenever the page is
 * hidden. Called once, from `main.tsx`, after the game first renders, with the
 * Rhyme Index load the game started: the load's sends wait for it, so nothing
 * here runs ahead of the game.
 */
export function startSessionRecords(indexLoad: Promise<unknown>): void {
  // A dev build is where the maintainer plays after reading the day's Answers,
  // and those Sessions would inflate the figure with no way to pick them out.
  if (!import.meta.env.PROD) return;
  const sender = createSessionRecordSender({
    enabled: true,
    storage: browserStorage,
    post: postRecord,
    today: () => localCalendarDate(),
    indexHash: __INDEX_HASH__,
    newId: randomId,
  });

  void afterIndexLoad(indexLoad, browserIdle).then(() => sender.flush("load"));
  const onHide = () => {
    if (document.visibilityState === "hidden") void sender.flush("hide");
  };
  document.addEventListener("visibilitychange", onHide);
  // Safari does not always fire `visibilitychange` when a tab is closed.
  window.addEventListener("pagehide", () => void sender.flush("hide"));
}
