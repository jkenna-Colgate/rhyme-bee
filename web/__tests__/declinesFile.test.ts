/**
 * The Declines file's **file**, as opposed to its format: what happens when a
 * ruling is appended to whatever is already on disk.
 *
 * `src/declines.ts` owns the format and is tested there. What is tested here is
 * the round trip through a real file — serialise, append, parse — because that
 * is where a ruling can be lost, and lost *silently*: `parseDeclines` drops a
 * line it cannot read rather than throwing over it, so a row that fuses onto an
 * unterminated last line takes both rulings with it and nothing anywhere says
 * so. The editor simply finds the Candidates they declined still on the queue.
 *
 * That is the mirror of `demotionFile.test.ts`'s hazard, which is loud — a fused
 * demotion stops the index building — and it is a live one for the same reason:
 * there is no un-decline in the tool, so reversing a ruling is a hand edit, the
 * file is designed to be opened in an editor between two machine appends, and an
 * editor that trims the last newline is all it takes.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseDeclines } from "../../src/declines.ts";
import { appendDecline, readDeclineText } from "../declinesFile.ts";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rhyme-bee-declines-"));
  path = join(dir, "declines.txt");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const COMMITTED = "# Rulings the editor has already made. Nothing here changes a verdict.\ndocked AA K T\n";

describe("appending a Decline to the standing rulings", () => {
  it("writes the ruling into a file that does not exist yet", () => {
    appendDecline(path, { word: "shellshocked", rhymeKey: "AA K T" });

    expect(parseDeclines(readFileSync(path, "utf8"))).toEqual([
      { word: "shellshocked", rhymeKey: "AA K T" },
    ]);
  });

  it("keeps every ruling already in the file, comments and all", () => {
    writeFileSync(path, COMMITTED);

    appendDecline(path, { word: "lbs", rhymeKey: "AH B AH L" });

    const text = readFileSync(path, "utf8");
    expect(text.startsWith(COMMITTED)).toBe(true);
    expect(parseDeclines(text)).toEqual([
      { word: "docked", rhymeKey: "AA K T" },
      { word: "lbs", rhymeKey: "AH B AH L" },
    ]);
  });

  /**
   * The hazard this suite exists for, and the reason it is worth a suite even
   * though nothing here can stop a build. Fused, the two rulings read as one
   * ruling for `docked` on a key no Candidate will ever be aimed at — so both
   * are gone, no error is raised, and the only symptom is a queue that will not
   * stay worked.
   */
  it("repairs a missing trailing newline instead of fusing two rulings", () => {
    writeFileSync(path, "# already ruled on\ndocked AA K T");

    appendDecline(path, { word: "lbs", rhymeKey: "AH B AH L" });

    expect(parseDeclines(readFileSync(path, "utf8"))).toEqual([
      { word: "docked", rhymeKey: "AA K T" },
      { word: "lbs", rhymeKey: "AH B AH L" },
    ]);
  });

  /**
   * The same fusion one step nastier, and the one this file is *most* exposed
   * to: the ruling itself records only that a Candidate was declined, so why it
   * was is written as a hand gloss — which means an unterminated last line
   * routinely ends inside a comment, and an entry appended after it is swallowed
   * whole.
   */
  it("does not append into the tail of a hand-written comment", () => {
    writeFileSync(path, "docked AA K T   # heard as a rhyme for `dock`; the reading is right");

    appendDecline(path, { word: "lbs", rhymeKey: "AH B AH L" });

    expect(parseDeclines(readFileSync(path, "utf8"))).toEqual([
      { word: "docked", rhymeKey: "AA K T" },
      { word: "lbs", rhymeKey: "AH B AH L" },
    ]);
  });

  it("leaves a CRLF file readable rather than fusing onto its last ruling", () => {
    writeFileSync(path, "docked AA K T\r\ntalked AA K T\r\n");

    appendDecline(path, { word: "lbs", rhymeKey: "AH B AH L" });

    expect(parseDeclines(readFileSync(path, "utf8")).map((d) => d.word)).toEqual([
      "docked",
      "talked",
      "lbs",
    ]);
  });

  it("writes no leading blank line into a file that exists but is empty", () => {
    writeFileSync(path, "");

    appendDecline(path, { word: "docked", rhymeKey: "AA K T" });

    expect(readFileSync(path, "utf8")).toBe("docked AA K T\n");
  });

  it("writes no leading blank line into a file holding only whitespace", () => {
    writeFileSync(path, "  \n");

    appendDecline(path, { word: "docked", rhymeKey: "AA K T" });

    expect(readFileSync(path, "utf8")).toBe("docked AA K T\n");
  });

  /**
   * The pair is the key, and it survives the file. Two rulings for one word
   * against two Rhyme Keys are two rulings, and a file that collapsed them would
   * hide a Candidate nobody had ruled on.
   */
  it("keeps one word's two rulings apart, because the key is the pair", () => {
    appendDecline(path, { word: "docked", rhymeKey: "AA K T" });
    appendDecline(path, { word: "docked", rhymeKey: "AA K" });

    expect(parseDeclines(readFileSync(path, "utf8"))).toEqual([
      { word: "docked", rhymeKey: "AA K T" },
      { word: "docked", rhymeKey: "AA K" },
    ]);
  });

  it("normalises the word on the way to disk, as the format does", () => {
    appendDecline(path, { word: "  Docked ", rhymeKey: "AA K T" });

    expect(readFileSync(path, "utf8")).toBe("docked AA K T\n");
  });
});

describe("reading the standing rulings", () => {
  it("reads a file that is not there as no rulings at all", () => {
    expect(readDeclineText(path)).toBe("");
    expect(parseDeclines(readDeclineText(path))).toEqual([]);
  });
});
