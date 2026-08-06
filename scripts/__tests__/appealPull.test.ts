/**
 * The pull's job is to land the bucket's Appealed words in the existing queue
 * without changing what that queue is. So the tests that matter are: the format
 * is the one `parseCandidates` already reads, and running twice appends nothing
 * the second time.
 *
 * The object bodies here are built with `serialiseCandidate` and keyed with
 * `candidateKey` — the same two functions the deployed endpoint writes with — so
 * these fixtures cannot drift from #119 by hand.
 */

import { describe, expect, it } from "vitest";
import {
  candidateKey,
  parseCandidates,
  serialiseCandidate,
  type SupplementCandidate,
} from "../../src/supplementCandidate.ts";
import {
  candidateKeysIn,
  parseEnvFile,
  readCredentials,
  selectNewCandidates,
  type AppealObject,
} from "../appealPull.ts";

const airburst: SupplementCandidate = {
  word: "airburst",
  seedWord: "burst",
  seedRhymeKey: "ER S T",
  reason: "not-a-known-word",
  engineRespelling: null,
  timestamp: "2026-08-05T19:00:00.000Z",
};

const overjoy: SupplementCandidate = {
  word: "overjoy",
  seedWord: "joy",
  seedRhymeKey: "OY",
  reason: "does-not-rhyme",
  engineRespelling: "OH-ver-joy",
  timestamp: "2026-08-05T20:30:00.000Z",
};

/** One object exactly as the deployed endpoint writes it. */
function objectFor(candidate: SupplementCandidate): AppealObject {
  return { key: candidateKey(candidate), body: serialiseCandidate(candidate) };
}

describe("choosing what to pull", () => {
  it("appends the batch as JSON Lines the existing queue reader accepts", () => {
    const selection = selectNewCandidates([objectFor(airburst), objectFor(overjoy)], new Set());

    expect(selection.added).toEqual([airburst, overjoy]);
    expect(parseCandidates(selection.append)).toEqual([airburst, overjoy]);
    expect(selection.append.endsWith("\n")).toBe(true);
  });

  it("appends objects in listing order, which the key makes chronological", () => {
    const listed = [objectFor(airburst), objectFor(overjoy)].sort((a, b) =>
      a.key.localeCompare(b.key),
    );
    expect(selectNewCandidates(listed, new Set()).added.map((c) => c.word)).toEqual([
      "airburst",
      "overjoy",
    ]);
  });

  it("produces a queue byte-identical to the one the dev flow writes", () => {
    const devFlow = serialiseCandidate(airburst) + serialiseCandidate(overjoy);
    expect(selectNewCandidates([objectFor(airburst), objectFor(overjoy)], new Set()).append).toBe(
      devFlow,
    );
  });

  it("handles an empty bucket without complaint", () => {
    expect(selectNewCandidates([], new Set())).toEqual({
      added: [],
      append: "",
      unreadable: [],
      misfiled: [],
    });
  });

  it("appends nothing on a second run over the same bucket", () => {
    const objects = [objectFor(airburst), objectFor(overjoy)];
    const first = selectNewCandidates(objects, new Set());

    const second = selectNewCandidates(objects, candidateKeysIn(first.append));

    expect(second.added).toEqual([]);
    expect(second.append).toBe("");
  });

  it("still skips a record the maintainer has judged and archived", () => {
    // `--archive` empties the queue into the archive, so the queue alone would
    // no longer remember the record and the pull would fetch it back.
    const queue = "";
    const archive = serialiseCandidate(airburst);

    const selection = selectNewCandidates(
      [objectFor(airburst), objectFor(overjoy)],
      candidateKeysIn(queue, archive),
    );

    expect(selection.added).toEqual([overjoy]);
  });

  it("keeps a record the queue has not seen alongside ones it has", () => {
    const selection = selectNewCandidates(
      [objectFor(airburst), objectFor(overjoy)],
      candidateKeysIn(serialiseCandidate(airburst)),
    );

    expect(selection.added).toEqual([overjoy]);
  });

  it("collapses a duplicate met twice within one batch", () => {
    const selection = selectNewCandidates([objectFor(airburst), objectFor(airburst)], new Set());
    expect(selection.added).toEqual([airburst]);
  });

  it("reports an object holding nothing readable, without failing the pull", () => {
    const selection = selectNewCandidates(
      [{ key: "flags/junk.json", body: "not json\n" }, objectFor(overjoy)],
      new Set(),
    );

    expect(selection.unreadable).toEqual(["flags/junk.json"]);
    expect(selection.added).toEqual([overjoy]);
  });

  it("reports a key its own record does not derive, but keeps the record", () => {
    // The silent-failure mode this ticket exists to avoid: if the writing end and
    // the pull disagree about the key, say so rather than returning nothing.
    const selection = selectNewCandidates(
      [{ key: "flags/2026-08-05T19:00:00.000Z-airburst.json", body: serialiseCandidate(airburst) }],
      new Set(),
    );

    expect(selection.misfiled).toEqual(["flags/2026-08-05T19:00:00.000Z-airburst.json"]);
    expect(selection.added).toEqual([airburst]);
  });
});

describe("the keys a queue accounts for", () => {
  it("derives each record's object key, so no ledger has to be kept", () => {
    expect(candidateKeysIn(serialiseCandidate(airburst))).toEqual(
      new Set(["flags/2026-08-05T19-00-00-000Z-airburst.json"]),
    );
  });

  it("reads the queue and the archive as one history", () => {
    expect(candidateKeysIn(serialiseCandidate(airburst), serialiseCandidate(overjoy)).size).toBe(2);
  });

  it("is empty for a queue that does not exist yet", () => {
    expect(candidateKeysIn("", "")).toEqual(new Set());
  });
});

describe("reading the local credentials", () => {
  it("reads KEY=value settings", () => {
    expect(parseEnvFile("R2_ACCOUNT_ID=abc\nR2_ACCESS_KEY_ID=def\n")).toEqual({
      R2_ACCOUNT_ID: "abc",
      R2_ACCESS_KEY_ID: "def",
    });
  });

  it("tolerates comments, blank lines, export prefixes and quotes", () => {
    expect(parseEnvFile('# a note\n\nexport R2_ACCOUNT_ID="abc"\n')).toEqual({
      R2_ACCOUNT_ID: "abc",
    });
  });

  it("skips a prose line the maintainer left themselves, rather than throwing", () => {
    expect(parseEnvFile("R2 token is in 1Password\nR2_ACCOUNT_ID=abc\n")).toEqual({
      R2_ACCOUNT_ID: "abc",
    });
  });

  it("defaults the bucket to the one #114 settled on", () => {
    const credentials = readCredentials({
      R2_ACCOUNT_ID: "abc",
      R2_ACCESS_KEY_ID: "def",
      R2_SECRET_ACCESS_KEY: "ghi",
    });
    expect(credentials.bucket).toBe("rhyme-bee-flags");
  });

  it("refuses loudly when a value is missing, naming what is missing", () => {
    // Silence here would read as "no Appeals today" instead of "no credential".
    expect(() => readCredentials({ R2_ACCOUNT_ID: "abc" })).toThrow(
      /R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY/,
    );
  });

  it("treats a blank value as missing", () => {
    expect(() =>
      readCredentials({ R2_ACCOUNT_ID: "abc", R2_ACCESS_KEY_ID: "  ", R2_SECRET_ACCESS_KEY: "g" }),
    ).toThrow(/R2_ACCESS_KEY_ID/);
  });
});
