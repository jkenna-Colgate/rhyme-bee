/**
 * Slice: judging a night's `add` words as a value. `resolveAddOutcome` has
 * never been testable before this — it judged each word and printed the
 * judgement in the same breath — so these are the first assertions about the
 * five cases an add actually distinguishes: refused, already reads, reads on
 * another key, written, and deferred (with its reason).
 *
 * The pinned-source context is built by hand rather than read off `data/`, and
 * the agent is a stub rather than a subprocess — the same reason
 * `readScheduledDay`'s tests build a fixture index instead of opening the
 * built artifact.
 */

import { describe, expect, it, vi } from "vitest";
import { Derivation, IndexDataSource } from "../../src/derivation.ts";
import type { Pronunciation, RhymeKey } from "../../src/phonology.ts";
import type { EvidenceContext } from "../../src/supplementEvidence.ts";
import type { AddTarget } from "../../web/src/editor/addOutcome.ts";
import { printAddOutcome, resolveAddOutcome } from "../editorAdd.ts";

function context(overrides: {
  pronunciations?: [string, Pronunciation[]][];
  words?: string[];
  names?: string[];
} = {}): EvidenceContext {
  const pronunciations = new Map(overrides.pronunciations ?? []);
  const words = new Set(overrides.words ?? []);
  const names = new Set(overrides.names ?? []);
  const derivation = new Derivation(new IndexDataSource({ words, pronunciations }));
  return { pronunciations, words, names, derivation };
}

// "EY T" — the Rhyme Key CONTEXT.md itself uses for "ate": both "gate" (a
// direct reading) and "ate" (the tail of a compound split below) read on it.
const TARGET: RhymeKey = "EY T";
const AIM: AddTarget = { target: TARGET, provenance: "test" };

const ctx = context({
  pronunciations: [
    ["gate", [["G", "EY1", "T"]]],
    ["cat", [["K", "AE1", "T"]]],
    ["tin", [["T", "IH1", "N"]]],
    ["ate", [["EY1", "T"]]],
  ],
  names: ["kate"],
});

/** Never called for a word the pure judgement never reaches an agent for. */
const unreachable = vi.fn(async (word: string): Promise<Pronunciation | null> => {
  throw new Error(`agent should not have been asked about "${word}"`);
});

describe("resolveAddOutcome", () => {
  it("returns a value rather than printing", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await resolveAddOutcome(["gate"], AIM, ctx, unreachable);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    error.mockRestore();
  });

  it("names the target and provenance it was aimed at", async () => {
    const outcome = await resolveAddOutcome([], AIM, ctx, unreachable);
    expect(outcome.target).toBe(TARGET);
    expect(outcome.provenance).toBe("test");
    expect(outcome.words).toEqual([]);
  });

  it("refuses a Proper Noun outright, never reaching a direct-reading check", async () => {
    const outcome = await resolveAddOutcome(["Kate"], AIM, ctx, unreachable);
    expect(outcome.words).toEqual([{ outcome: "refused-name", word: "kate" }]);
  });

  it("reports a word that already reads on the target as needing nothing, carrying the reading", async () => {
    const outcome = await resolveAddOutcome(["gate"], AIM, ctx, unreachable);
    expect(outcome.words).toEqual([
      {
        outcome: "already-reads",
        word: "gate",
        readings: [{ phonemes: ["G", "EY1", "T"], key: "EY T" }],
      },
    ]);
  });

  it("reports a word that reads on another key as a correction, carrying every reading it already has", async () => {
    const outcome = await resolveAddOutcome(["cat"], AIM, ctx, unreachable);
    expect(outcome.words).toEqual([
      {
        outcome: "reads-on-another-key",
        word: "cat",
        readings: [{ phonemes: ["K", "AE1", "T"], key: "AE T" }],
      },
    ]);
  });

  it("writes a reading composed from a compound split, carrying the parts", async () => {
    const outcome = await resolveAddOutcome(["tinate"], AIM, ctx, unreachable);
    expect(outcome.words).toEqual([
      {
        outcome: "written",
        word: "tinate",
        phonemes: ["T", "IH1", "N", "EY2", "T"],
        composed: {
          phonemes: ["T", "IH1", "N", "EY2", "T"],
          key: TARGET,
          head: { word: "tin", phonemes: ["T", "IH1", "N"] },
          tail: { word: "ate", phonemes: ["EY1", "T"] },
        },
      },
    ]);
  });

  it("writes a reading the agent authored once no split reaches the target", async () => {
    const author = vi.fn(async (word: string) =>
      word === "gleeb" ? (["G", "L", "EY1", "T"] as Pronunciation) : null,
    );
    const outcome = await resolveAddOutcome(["gleeb"], AIM, ctx, author);
    expect(outcome.words).toEqual([
      { outcome: "written", word: "gleeb", phonemes: ["G", "L", "EY1", "T"], composed: null },
    ]);
    expect(author).toHaveBeenCalledWith("gleeb", TARGET);
  });

  it("defers a word the agent did not answer for", async () => {
    const author = vi.fn(async () => null);
    const outcome = await resolveAddOutcome(["zorp"], AIM, ctx, author);
    expect(outcome.words).toEqual([
      { outcome: "deferred", word: "zorp", reason: "agent-unavailable", proposed: null },
    ]);
  });

  it("defers a word whose agent-proposed reading fails verification, keeping the proposal", async () => {
    const author = vi.fn(async () => ["F", "L", "AA1", "B"] as Pronunciation);
    const outcome = await resolveAddOutcome(["flurb"], AIM, ctx, author);
    expect(outcome.words).toEqual([
      {
        outcome: "deferred",
        word: "flurb",
        reason: "agent-reading-failed-verification",
        proposed: ["F", "L", "AA1", "B"],
      },
    ]);
  });

  it("partitions a mixed list into every case, independently and in order", async () => {
    const author = vi.fn(async (word: string) => {
      if (word === "gleeb") return ["G", "L", "EY1", "T"] as Pronunciation;
      if (word === "zorp") return null;
      throw new Error(`unexpected agent call for "${word}"`);
    });
    const outcome = await resolveAddOutcome(
      ["Kate", "gate", "cat", "tinate", "gleeb", "zorp"],
      AIM,
      ctx,
      author,
    );
    expect(outcome.words.map((w) => [w.word, w.outcome])).toEqual([
      ["kate", "refused-name"],
      ["gate", "already-reads"],
      ["cat", "reads-on-another-key"],
      ["tinate", "written"],
      ["gleeb", "written"],
      ["zorp", "deferred"],
    ]);
  });
});

/**
 * `printAddOutcome` renders every case verbatim over the real CLI (see the
 * ticket's manual byte-diff), except the two that go through the agent: a
 * live `claude` subprocess is exactly what the stub above exists to avoid.
 * These lock down that rendering the same way — against the value, not a
 * subprocess — so the trap the ticket calls out (verifying the happy path and
 * missing a regression in a failure path only the agent reaches) has an
 * assertion behind it rather than just a read of the code.
 */
describe("printAddOutcome", () => {
  function captured(outcome: Awaited<ReturnType<typeof resolveAddOutcome>>): string[] {
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((line: string) => {
      lines.push(line);
    });
    printAddOutcome(outcome);
    log.mockRestore();
    return lines;
  }

  it("renders a reading the agent authored, and the written summary", async () => {
    const author = vi.fn(async () => ["G", "L", "EY1", "T"] as Pronunciation);
    const outcome = await resolveAddOutcome(["gleeb"], AIM, ctx, author);

    expect(captured(outcome)).toEqual([
      "",
      "  Adding 1 word(s) against EY T  ·  test",
      "",
      "  gleeb",
      "    no compound split reaches EY T — asking the agent to author one.",
      "    the agent proposed  G L EY1 T  — verified against EY T.",
      "",
      "  1 reading(s) appended to data/supplement.dict.",
      "  Commit it, then npm run deploy — the fix applies to every Puzzle",
      "  the word appears in, and a Session already in progress picks it up.",
      "",
    ]);
  });

  it("renders a word the agent did not answer for, and the deferred summary", async () => {
    const author = vi.fn(async () => null);
    const outcome = await resolveAddOutcome(["zorp"], AIM, ctx, author);

    expect(captured(outcome)).toEqual([
      "",
      "  Adding 1 word(s) against EY T  ·  test",
      "",
      "  zorp",
      "    no compound split reaches EY T — asking the agent to author one.",
      "    the agent did not answer. Deferred.",
      "",
      "  1 word(s) appended to data/deferred-readings.jsonl for a later pass.",
      "",
    ]);
  });

  it("renders a word the agent proposed but failed verification, naming the proposal", async () => {
    const author = vi.fn(async () => ["F", "L", "AA1", "B"] as Pronunciation);
    const outcome = await resolveAddOutcome(["flurb"], AIM, ctx, author);

    expect(captured(outcome)).toEqual([
      "",
      "  Adding 1 word(s) against EY T  ·  test",
      "",
      "  flurb",
      "    no compound split reaches EY T — asking the agent to author one.",
      "    the agent proposed  F L AA1 B, which does not reach EY T. Deferred.",
      "",
      "  1 word(s) appended to data/deferred-readings.jsonl for a later pass.",
      "",
    ]);
  });

  it("renders 'Nothing to write' when every word was refused or already read", async () => {
    const outcome = await resolveAddOutcome(["Kate", "gate"], AIM, ctx, unreachable);
    const lines = captured(outcome);
    expect(lines.at(-2)).toBe("  Nothing to write.");
  });
});
