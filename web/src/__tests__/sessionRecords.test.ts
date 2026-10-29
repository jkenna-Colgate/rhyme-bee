/**
 * The sending rule for Session Records (ADR-0019, #230): on load and when the
 * page is hidden, send every stored Daily Puzzle Session that is new or has
 * grown since it was last sent. Tested through the sender's own interface, with
 * an in-memory store standing in for `localStorage` and a stand-in route in
 * place of the network.
 */

import { describe, expect, it } from "vitest";
import { makeTestIndex } from "../../../src/__fixtures__/index.ts";
import { recordFromBody, type SessionRecord } from "../../../src/sessionRecord.ts";
import { Session } from "../../../src/session.ts";
import { snapshot, snapshotKey } from "../../../src/sessionSnapshot.ts";
import {
  afterIndexLoad,
  createSessionRecordSender,
  RECORD_LEDGER_KEY,
  type RecordStorage,
} from "../sessionRecords.ts";

const TODAY = "2026-10-29";
const HASH = "6097632138aad59e";
const index = makeTestIndex();

function memoryStorage(): RecordStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    keys: () => [...map.keys()],
    get: (key) => map.get(key) ?? null,
    set: (key, value) => void map.set(key, value),
  };
}

/** Store a Daily Puzzle Session the way `usePuzzleSession` does. */
function store(storage: RecordStorage, date: string, submissions: string[], ended = false): void {
  let session = Session.start(index, index.pinSeed("ate"));
  for (const word of submissions) session = session.submit(word).session;
  if (ended) session = session.end();
  storage.set(snapshotKey(date), snapshot({ session, submissions }, { date }));
}

/**
 * A stand-in route that keeps what it accepts by date and id, as the bucket
 * does, and accepts at most `budget` requests before refusing like the limiter.
 */
function route(options: { budget?: number; down?: boolean } = {}) {
  const kept = new Map<string, SessionRecord>();
  const requests: { body: string; keepalive: boolean }[] = [];
  let budget = options.budget ?? Infinity;
  const post = async (body: string, init: { keepalive: boolean }): Promise<boolean> => {
    requests.push({ body, ...init });
    if (options.down) throw new TypeError("Failed to fetch");
    if (budget <= 0) return false;
    budget -= 1;
    const result = recordFromBody(JSON.parse(body));
    if (!result.ok) return false;
    kept.set(`${result.record.date}/${result.record.id}`, result.record);
    return true;
  };
  return {
    kept,
    requests,
    post,
    refill(n: number) {
      budget = n;
    },
  };
}

let counter = 0;
function sender(storage: RecordStorage, post: ReturnType<typeof route>["post"], enabled = true) {
  return createSessionRecordSender({
    enabled,
    storage,
    post,
    today: () => TODAY,
    indexHash: HASH,
    newId: () => (counter++).toString(16).padStart(32, "0"),
  });
}

describe("sending Session Records", () => {
  it("sends today's Session once, and again only when it has grown, under the same id", async () => {
    const storage = memoryStorage();
    const server = route();
    const send = sender(storage, server.post);

    store(storage, TODAY, ["late", "eight"]);
    await send.flush("hide");
    await send.flush("hide");
    expect(server.requests).toHaveLength(1);
    expect(server.kept.size).toBe(1);

    store(storage, TODAY, ["late", "eight", "weight"], true);
    await send.flush("hide");
    expect(server.requests).toHaveLength(2);
    expect(server.kept.size).toBe(1);
    const [record] = [...server.kept.values()];
    expect(record).toMatchObject({
      date: TODAY,
      seed: { word: "ate" },
      submissions: ["late", "eight", "weight"],
      ended: true,
      indexHash: HASH,
    });
  });

  it("uses a send that survives the page going away when the page is hidden", async () => {
    const storage = memoryStorage();
    const server = route();
    store(storage, TODAY, ["late"]);
    await sender(storage, server.post).flush("hide");
    expect(server.requests[0]!.keepalive).toBe(true);
  });

  it("sends the load's history without keepalive, whose bodies share a 64 KB budget", async () => {
    const storage = memoryStorage();
    const server = route();
    store(storage, TODAY, ["late"]);
    store(storage, "2026-08-06", ["eight"]);
    await sender(storage, server.post).flush("load");
    expect(server.requests.map((request) => request.keepalive)).toEqual([false, false]);
  });

  it("carries the index hash only on today's Session, and a different id on every date", async () => {
    const storage = memoryStorage();
    const server = route();
    store(storage, TODAY, ["late"]);
    store(storage, "2026-10-28", ["eight"]);
    store(storage, "2026-08-06", ["weight"]);
    await sender(storage, server.post).flush("load");

    const records = [...server.kept.values()];
    expect(records).toHaveLength(3);
    for (const record of records) {
      if (record.date === TODAY) expect(record.indexHash).toBe(HASH);
      else expect(record).not.toHaveProperty("indexHash");
    }
    expect(new Set(records.map((record) => record.id)).size).toBe(3);
  });

  it("sends nothing that identifies the player or the browser", async () => {
    const storage = memoryStorage();
    const server = route();
    store(storage, TODAY, ["late"]);
    await sender(storage, server.post).flush("load");
    expect(Object.keys(JSON.parse(server.requests[0]!.body)).sort()).toEqual(
      ["date", "ended", "id", "indexHash", "seed", "submissions"],
    );
  });

  it("gets a long history recorded within a few visits when the limiter refuses some", async () => {
    const storage = memoryStorage();
    const server = route({ budget: 20 });
    for (let day = 1; day <= 50; day++) {
      store(storage, `2026-09-${String((day % 30) + 1).padStart(2, "0")}`, ["late"]);
      store(storage, `2026-08-${String((day % 28) + 1).padStart(2, "0")}`, ["eight"]);
    }
    const held = [...storage.map.keys()].filter((key) => key !== RECORD_LEDGER_KEY).length;

    for (let visit = 0; visit < 4 && server.kept.size < held; visit++) {
      await sender(storage, server.post).flush("load");
      server.refill(20);
    }
    expect(server.kept.size).toBe(held);
  });

  it("is silent and plays on when the route is down, and retries on the next visit", async () => {
    const storage = memoryStorage();
    const down = route({ down: true });
    store(storage, TODAY, ["late"]);
    await expect(sender(storage, down.post).flush("load")).resolves.toBeUndefined();
    await expect(sender(storage, down.post).flush("hide")).resolves.toBeUndefined();

    const up = route();
    await sender(storage, up.post).flush("load");
    expect(up.kept.size).toBe(1);
  });

  it("keeps the same id across a failed send, so a lost response cannot duplicate a Session", async () => {
    const storage = memoryStorage();
    const limited = route({ budget: 0 });
    store(storage, TODAY, ["late"]);
    await sender(storage, limited.post).flush("load");
    await sender(storage, limited.post).flush("load");
    const ids = limited.requests.map((request) => JSON.parse(request.body).id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it("sends nothing from a dev build", async () => {
    const storage = memoryStorage();
    const server = route();
    store(storage, TODAY, ["late"]);
    await sender(storage, server.post, false).flush("load");
    await sender(storage, server.post, false).flush("hide");
    expect(server.requests).toEqual([]);
  });

  it("sends only stored Daily Puzzle Sessions, never anything else the origin keeps", async () => {
    const storage = memoryStorage();
    const server = route();
    storage.set("rhyme-bee:visited", "1");
    storage.set("someone-else:session:2026-10-29", "{}");
    storage.set(snapshotKey(TODAY), "not a snapshot");
    await sender(storage, server.post).flush("load");
    expect(server.requests).toEqual([]);
  });

  it("does not send a Session the route would refuse, such as one holding a stray paste", async () => {
    const storage = memoryStorage();
    const server = route();
    store(storage, TODAY, ["late", "https://example.com/a-pasted-link"]);
    await sender(storage, server.post).flush("load");
    expect(server.requests).toEqual([]);
  });

  it("never throws when storage itself throws", async () => {
    const server = route();
    const broken: RecordStorage = {
      keys: () => {
        throw new Error("SecurityError");
      },
      get: () => null,
      set: () => undefined,
    };
    await expect(sender(broken, server.post).flush("load")).resolves.toBeUndefined();
  });
});

describe("when the load's sends start", () => {
  /** An idle queue the test runs by hand, standing in for `requestIdleCallback`. */
  function idleQueue() {
    const queued: (() => void)[] = [];
    return {
      idle: (run: () => void) => void queued.push(run),
      runIdle: () => queued.splice(0).forEach((run) => run()),
    };
  }

  /** Whether a promise has settled, after letting every pending callback run. */
  async function settled(promise: Promise<unknown>): Promise<boolean> {
    let done = false;
    void promise.then(() => (done = true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    return done;
  }

  it("waits for the Rhyme Index to load and then for idle time, so nothing competes with play", async () => {
    let finishLoad!: () => void;
    const indexLoad = new Promise<void>((resolve) => (finishLoad = resolve));
    const { idle, runIdle } = idleQueue();
    const start = afterIndexLoad(indexLoad, idle);

    runIdle();
    expect(await settled(start)).toBe(false);
    finishLoad();
    expect(await settled(start)).toBe(false);
    runIdle();
    expect(await settled(start)).toBe(true);
  });

  it("still starts when the Rhyme Index fails to load", async () => {
    const { idle, runIdle } = idleQueue();
    const start = afterIndexLoad(Promise.reject(new Error("offline")), idle);
    await settled(start);
    runIdle();
    expect(await settled(start)).toBe(true);
  });
});
