/**
 * The demotion list's **file**, as opposed to its format: what happens when an
 * entry is appended to whatever is already on disk.
 *
 * `src/demotions.ts` owns the format and is tested there. What is tested here is
 * the round trip through a real file — serialise, append, parse — because that
 * is where `data/demotions.txt` can be destroyed. It is committed data, and
 * `parseDemotions` throws on a line it cannot read *for the whole file*: a row
 * that fuses onto an unterminated last line does not lose one demotion, it stops
 * the index building at all.
 *
 * The hazard is a missing trailing newline, and it is a live one here rather
 * than a theoretical one. `#160` puts no un-demote in the tool on purpose, so a
 * reversal is a **hand edit** — which means the file is designed to be opened in
 * an editor between two machine appends, and an editor that trims the last
 * newline is all it takes. The case below that appends to a file lacking one is
 * the point of this suite.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseDemotions } from "../../src/demotions.ts";
import { appendDemotion, readDemotionText } from "../demotionFile.ts";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rhyme-bee-demotions-"));
  path = join(dir, "demotions.txt");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const COMMITTED = "# names the upstream word list wrongly calls words\nheinz proper-noun\n";

describe("appending a demotion to the committed list", () => {
  it("writes the entry into a file that does not exist yet", () => {
    appendDemotion(path, { word: "algiers", reason: "proper-noun" });

    expect(parseDemotions(readFileSync(path, "utf8"))).toEqual([
      { word: "algiers", reason: "proper-noun" },
    ]);
  });

  it("keeps every entry already in the file, comments and all", () => {
    writeFileSync(path, COMMITTED);

    appendDemotion(path, { word: "lbs", reason: "not-a-known-word" });

    const text = readFileSync(path, "utf8");
    expect(text.startsWith(COMMITTED)).toBe(true);
    expect(parseDemotions(text)).toEqual([
      { word: "heinz", reason: "proper-noun" },
      { word: "lbs", reason: "not-a-known-word" },
    ]);
  });

  /**
   * The hazard this suite exists for. `serialiseDemotion` returns a
   * newline-*terminated* line, so an append onto a file whose last line is
   * unterminated fuses the two into `heinz proper-noun algiers proper-noun` —
   * four fields on one line, which `parseDemotions` refuses, taking the whole
   * committed list with it and stopping `npm run build:index`.
   *
   * Repaired on the write side rather than by loosening the parser: a parser
   * that split a fused row could not tell corruption from data, and would let
   * the file rot quietly in exactly the circumstance where being loud is the
   * only remedy left.
   */
  it("repairs a missing trailing newline instead of fusing two entries", () => {
    writeFileSync(path, "# a surname, not a word\nheinz proper-noun");

    appendDemotion(path, { word: "algiers", reason: "proper-noun" });

    expect(parseDemotions(readFileSync(path, "utf8"))).toEqual([
      { word: "heinz", reason: "proper-noun" },
      { word: "algiers", reason: "proper-noun" },
    ]);
  });

  /**
   * The same fusion, one step nastier: a hand-written entry carries a trailing
   * `#` gloss, so an unterminated last line ends inside a comment and the
   * appended entry is swallowed by it rather than throwing. Nothing is corrupt,
   * nothing is loud, and the word is simply never demoted.
   */
  it("does not append into the tail of a hand-written comment", () => {
    writeFileSync(path, "heinz proper-noun  # H. J. Heinz");

    appendDemotion(path, { word: "algiers", reason: "proper-noun" });

    expect(parseDemotions(readFileSync(path, "utf8"))).toEqual([
      { word: "heinz", reason: "proper-noun" },
      { word: "algiers", reason: "proper-noun" },
    ]);
  });

  it("leaves a CRLF file readable rather than fusing onto its last entry", () => {
    writeFileSync(path, "heinz proper-noun\r\nmarx proper-noun\r\n");

    appendDemotion(path, { word: "algiers", reason: "proper-noun" });

    expect(parseDemotions(readFileSync(path, "utf8")).map((d) => d.word)).toEqual([
      "heinz",
      "marx",
      "algiers",
    ]);
  });

  it("writes no leading blank line into a file that exists but is empty", () => {
    writeFileSync(path, "");

    appendDemotion(path, { word: "algiers", reason: "proper-noun" });

    expect(readFileSync(path, "utf8")).toBe("algiers proper-noun\n");
  });

  it("appends the reason that was chosen, not a default", () => {
    appendDemotion(path, { word: "oct", reason: "not-a-known-word" });
    appendDemotion(path, { word: "troy", reason: "proper-noun" });

    expect(parseDemotions(readFileSync(path, "utf8"))).toEqual([
      { word: "oct", reason: "not-a-known-word" },
      { word: "troy", reason: "proper-noun" },
    ]);
  });
});

describe("reading the demotion list", () => {
  it("reads a file that is not there as no demotions at all", () => {
    expect(readDemotionText(path)).toBe("");
    expect(parseDemotions(readDemotionText(path))).toEqual([]);
  });
});
