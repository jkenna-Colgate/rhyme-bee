/**
 * Appending a Normalisation Exception to its file (#323): the line the build
 * reads back, after whatever the maintainer wrote there by hand.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseNormalisationExceptions } from "../../src/normalisationExceptions.ts";
import { appendNormalisationException } from "../normalisationExceptionFile.ts";

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "normalisation-exceptions-"));
  path = join(dir, "normalisation-exceptions.txt");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const flower = { word: "flower", reading: ["F", "L", "AW1", "R"] };

describe("appending a Normalisation Exception", () => {
  it("adds a line the build reads, under the file's comments", () => {
    writeFileSync(path, "# the header\n");

    appendNormalisationException(path, flower);

    expect(readFileSync(path, "utf8")).toBe("# the header\nflower F L AW1 R\n");
    expect(parseNormalisationExceptions(readFileSync(path, "utf8")).entries).toEqual([flower]);
  });

  it("does not run the line into a hand-written last line with no newline", () => {
    writeFileSync(path, "power P AW1 R  # by hand");

    appendNormalisationException(path, flower);

    expect(parseNormalisationExceptions(readFileSync(path, "utf8")).entries.map((e) => e.word)).toEqual(["power", "flower"]);
  });

  it("writes the first line of a file that is not there yet", () => {
    appendNormalisationException(path, flower);

    expect(readFileSync(path, "utf8")).toBe("flower F L AW1 R\n");
  });
});
