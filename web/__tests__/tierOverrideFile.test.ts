/**
 * The Retrieval override layer's **file**, as opposed to its format: what
 * happens when a row is appended to whatever is already on disk.
 *
 * `src/tierOverride.ts` owns the format and is tested there. What is tested here
 * is the round trip through a real file — serialise, append, parse — because
 * that is where the layer can be destroyed. `data/tier-overrides.csv` is
 * append-only and can never be regenerated (ADR-0015): a row that fuses onto an
 * unterminated last line makes `parseTierOverrides` throw over the *whole file*,
 * and every judgement in it is then unreadable. The hazard is a missing trailing
 * newline, and the case below that appends to a file lacking one is the point of
 * this suite.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TIER_OVERRIDE_HEADER,
  parseTierOverrides,
  resolveTierOverrides,
  type TierOverrideRow,
} from "../../src/tierOverride.ts";
import { appendTierOverride, readTierOverrideText } from "../tierOverrideFile.ts";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rhyme-bee-overrides-"));
  path = join(dir, "tier-overrides.csv");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function row(word: string, over: Partial<TierOverrideRow> = {}): TierOverrideRow {
  return {
    word,
    verdict: "bonus",
    measured: 1.2119,
    decided: "2026-08-08T10:00:00.000Z",
    note: "",
    ...over,
  };
}

describe("appending a judgement to the override file", () => {
  it("writes the header when there is no file yet", () => {
    appendTierOverride(path, row("counterthrust"));

    const text = readFileSync(path, "utf8");
    expect(text.split("\n")[0]).toBe(TIER_OVERRIDE_HEADER);
    expect(parseTierOverrides(text)).toEqual([row("counterthrust")]);
  });

  it("writes the header into a file that exists but is empty", () => {
    writeFileSync(path, "");
    appendTierOverride(path, row("counterthrust"));

    const text = readFileSync(path, "utf8");
    expect(text.split("\n")[0]).toBe(TIER_OVERRIDE_HEADER);
    expect(parseTierOverrides(text)).toEqual([row("counterthrust")]);
  });

  it("does not write the header a second time", () => {
    appendTierOverride(path, row("counterthrust"));
    appendTierOverride(path, row("misadjust", { verdict: "answer-rare", measured: 0.8149 }));

    const text = readFileSync(path, "utf8");
    expect(text.split("\n").filter((line) => line === TIER_OVERRIDE_HEADER)).toHaveLength(1);
    expect(parseTierOverrides(text)).toEqual([
      row("counterthrust"),
      row("misadjust", { verdict: "answer-rare", measured: 0.8149 }),
    ]);
  });

  /**
   * The hazard this suite exists for. `serialiseTierOverride` returns a
   * newline-*terminated* line, so an append onto a file whose last line is
   * unterminated fuses the two into one row of ten columns — and
   * `parseTierOverrides` throws on it, taking every judgement in the file with
   * it. Repaired on the write side rather than by loosening the parser: a parser
   * that tolerated a fused row would hide the corruption instead of refusing it,
   * in a file that cannot be rebuilt.
   */
  it("repairs a missing trailing newline instead of fusing two rows", () => {
    writeFileSync(
      path,
      `${TIER_OVERRIDE_HEADER}\ncounterthrust,bonus,1.2119,2026-08-07T09:00:00.000Z,`,
    );

    appendTierOverride(path, row("misadjust", { verdict: "answer-rare", measured: 0.8149 }));

    const parsed = parseTierOverrides(readFileSync(path, "utf8"));
    expect(parsed.map((r) => r.word)).toEqual(["counterthrust", "misadjust"]);
    expect(parsed[0]!.decided).toBe("2026-08-07T09:00:00.000Z");
  });

  it("repairs a missing trailing newline on a header-only file", () => {
    writeFileSync(path, TIER_OVERRIDE_HEADER);

    appendTierOverride(path, row("counterthrust"));

    expect(parseTierOverrides(readFileSync(path, "utf8"))).toEqual([row("counterthrust")]);
  });

  it("leaves a CRLF file readable rather than fusing onto its last row", () => {
    writeFileSync(
      path,
      `${TIER_OVERRIDE_HEADER}\r\ncounterthrust,bonus,1.2119,2026-08-07T09:00:00.000Z,\r\n`,
    );

    appendTierOverride(path, row("misadjust", { verdict: "answer-rare", measured: 0.8149 }));

    expect(parseTierOverrides(readFileSync(path, "utf8")).map((r) => r.word)).toEqual([
      "counterthrust",
      "misadjust",
    ]);
  });

  it("keeps a word's history and lets the last row win, reversal flag and all", () => {
    appendTierOverride(path, row("counterthrust", { verdict: "bonus" }));
    appendTierOverride(path, row("counterthrust", { verdict: "none" }));

    const resolved = resolveTierOverrides(parseTierOverrides(readFileSync(path, "utf8")));
    expect(resolved.get("counterthrust")).toMatchObject({ verdict: "none", rows: 2 });
  });

  it("round-trips a note carrying a comma and a quote", () => {
    const noted = row("counterthrust", { note: 'reads as "obvious", nobody retrieves it' });
    appendTierOverride(path, noted);

    expect(parseTierOverrides(readFileSync(path, "utf8"))).toEqual([noted]);
  });

  it("records a word with no prevalence row distinguishably from one with a value", () => {
    appendTierOverride(path, row("bussed", { measured: null }));
    appendTierOverride(path, row("counterthrust", { measured: 1.2119 }));

    const parsed = parseTierOverrides(readFileSync(path, "utf8"));
    expect(parsed[0]!.measured).toBeNull();
    expect(parsed[1]!.measured).toBe(1.2119);
    // Empty, not `0` and not the string "null" — the file's own way of saying
    // "the lemmatiser never had a row for this", which is a coverage problem
    // rather than a disagreement with the data (ADR-0015).
    expect(readFileSync(path, "utf8")).toContain("bussed,bonus,,");
  });
});

describe("reading the override file", () => {
  it("reads a file that was never written as no overrides at all", () => {
    expect(readTierOverrideText(path)).toBe("");
    expect(parseTierOverrides(readTierOverrideText(path))).toEqual([]);
  });
});
