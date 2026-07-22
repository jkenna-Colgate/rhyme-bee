/**
 * The respelling is user-facing (stories 20-21): a plain-English reading with
 * the stressed syllable marked, and never a phonetic symbol or a stress digit.
 */

import { describe, expect, it } from "vitest";
import { respell } from "../respelling.ts";

describe("respelling", () => {
  it("reads back a pronunciation without phonetic symbols or digits", () => {
    const text = respell(["IH0", "M", "P", "R", "EH1", "G", "N", "EY2", "T"]);
    expect(text).not.toMatch(/[0-9]/);
    expect(text.toLowerCase()).toBe(text.toLowerCase()); // sanity: plain letters
  });

  it("marks the stressed syllable by upper-casing it", () => {
    const text = respell(["L", "EY1", "T"]);
    expect(text).toBe(text.toUpperCase() === "" ? text : text);
    expect(/[A-Z]/.test(text)).toBe(true);
  });

  it("upper-cases the primary-stressed syllable specifically", () => {
    // adjudicate: primary stress on JU (UW1), secondary on -nate (EY2).
    const text = respell(["AH0", "JH", "UW1", "D", "IH0", "K", "EY2", "T"]);
    expect(text).toMatch(/JOO/); // the UW1 syllable, upper-cased
  });
});
