/**
 * The gate on whether an agent's reply is a reading at all. Pure, and the sole
 * thing standing between an agent's prose and the deferred queue, so it is
 * tested apart from the invocation that produces the text — which stays
 * untested, as the rest of the Editor's Pass shell does.
 */

import { describe, expect, it } from "vitest";
import { parseReading } from "../editorReading.ts";

describe("parseReading", () => {
  it("reads a clean single-line reading", () => {
    expect(parseReading("EY1 T")).toEqual(["EY1", "T"]);
  });

  it("takes the reading out from under a preamble", () => {
    // Asked for phonemes and nothing else, an agent still sometimes explains
    // itself first. The reading is the last line it settles on.
    const reply = "Sure — here is the pronunciation:\n\nP L EY2 S HH OW2 L D ER0";
    expect(parseReading(reply)).toEqual(["P", "L", "EY2", "S", "HH", "OW2", "L", "D", "ER0"]);
  });

  it("ignores trailing blank lines and surrounding whitespace", () => {
    expect(parseReading("\n\n  EY1 T  \n\n")).toEqual(["EY1", "T"]);
  });

  it("accepts stress digits 0, 1 and 2 alike", () => {
    expect(parseReading("OW0 OW1 OW2")).toEqual(["OW0", "OW1", "OW2"]);
  });

  it("accepts a reading whose phonemes are separated by more than one space", () => {
    expect(parseReading("EY1   T")).toEqual(["EY1", "T"]);
  });

  it("uppercases a reading an agent wrote in lower case", () => {
    expect(parseReading("ey1 t")).toEqual(["EY1", "T"]);
  });

  it("yields nothing for an empty reply", () => {
    expect(parseReading("")).toBeNull();
  });

  it("yields nothing for a whitespace-only reply", () => {
    expect(parseReading("   \n\t\n  ")).toBeNull();
  });

  it("yields nothing when the last line holds a token that is not ARPAbet", () => {
    // Prose in the position a reading was asked for. Rejecting it defers the
    // word, which is the safe direction: `verifyReading` would refuse it anyway.
    expect(parseReading("EY1 T (as in 'ate')")).toBeNull();
    expect(parseReading("I cannot pronounce that word.")).toBeNull();
  });

  it("yields nothing when a stress digit is not one ARPAbet uses", () => {
    expect(parseReading("EY3 T")).toBeNull();
  });

  it("yields nothing when a phoneme is longer than ARPAbet allows", () => {
    expect(parseReading("EYYY1 T")).toBeNull();
  });
});
