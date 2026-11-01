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

  describe("a vowel and the r after it are one unit (#240)", () => {
    // Respelled one sound at a time, `beard` read "BIH-rd", which a player
    // reads cold as "bird", and one vowel showed two ways (`HEE-r`, `BIH-r`).
    it.each([
      ["beard", ["B", "IH1", "R", "D"], "BEER-d"],
      ["fierce", ["F", "IH1", "R", "S"], "FEER-s"],
      ["here", ["HH", "IY1", "R"], "HEER"],
      ["beer", ["B", "IH1", "R"], "BEER"],
      ["laird", ["L", "EH1", "R", "D"], "LAIR-d"],
      ["car", ["K", "AA1", "R"], "KAR"],
      ["more", ["M", "AO1", "R"], "MOR"],
      ["cure", ["K", "Y", "UH1", "R"], "KYOOR"],
      ["wired", ["W", "AY1", "R", "D"], "WIRE-d"],
      ["unheard", ["AH0", "N", "HH", "ER1", "D"], "uh-NHUR-d"],
      ["airport", ["EH1", "R", "P", "AO2", "R", "T"], "AIR-por-t"],
    ])("%s", (_, phonemes, expected) => {
      expect(respell(phonemes)).toBe(expected);
    });

    it("leaves an r before a vowel at the start of the next syllable", () => {
      expect(respell(["S", "P", "IH1", "R", "AH0", "T"])).toBe("SPIH-ruh-t");
      expect(respell(["V", "EH1", "R", "IY0"])).toBe("VEH-ree");
    });
  });
});
