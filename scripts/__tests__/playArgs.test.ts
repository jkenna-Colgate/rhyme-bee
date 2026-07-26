import { describe, expect, it } from "vitest";
import { DAYS, parsePlayArgs } from "../playArgs.ts";

describe("parsePlayArgs", () => {
  it("parses no flags to an empty selection", () => {
    expect(parsePlayArgs([])).toEqual({});
  });

  describe("space-separated form", () => {
    it("reads --seed <word>", () => {
      expect(parsePlayArgs(["--seed", "book"])).toEqual({ seed: "book" });
    });

    it("reads --day <n>", () => {
      expect(parsePlayArgs(["--day", "6"])).toEqual({ day: 6 });
    });
  });

  describe("equals form (survives PowerShell's -- handling)", () => {
    it("reads --seed=<word>", () => {
      expect(parsePlayArgs(["--seed=books"])).toEqual({ seed: "books" });
    });

    it("reads --day=<n>", () => {
      expect(parsePlayArgs(["--day=6"])).toEqual({ day: 6 });
    });

    it("parses the equals form identically to the space form", () => {
      expect(parsePlayArgs(["--day=6"])).toEqual(parsePlayArgs(["--day", "6"]));
      expect(parsePlayArgs(["--seed=book"])).toEqual(parsePlayArgs(["--seed", "book"]));
    });
  });

  describe("validation", () => {
    it("rejects --seed with no word", () => {
      expect(() => parsePlayArgs(["--seed"])).toThrow(/--seed needs a word/);
    });

    it("rejects an empty --seed= value", () => {
      expect(() => parsePlayArgs(["--seed="])).toThrow(/--seed needs a word/);
    });

    it("rejects a non-integer --day", () => {
      expect(() => parsePlayArgs(["--day", "nope"])).toThrow(/--day needs an integer/);
    });

    it("rejects a non-integer --day= with the same message as the space form", () => {
      expect(() => parsePlayArgs(["--day=nope"])).toThrow(/--day needs an integer/);
    });

    it("rejects --day below the range in either form", () => {
      expect(() => parsePlayArgs(["--day", "0"])).toThrow(/--day needs an integer/);
      expect(() => parsePlayArgs(["--day=0"])).toThrow(/--day needs an integer/);
    });

    it(`rejects --day above ${DAYS} in either form`, () => {
      expect(() => parsePlayArgs(["--day", String(DAYS + 1)])).toThrow(/--day needs an integer/);
      expect(() => parsePlayArgs([`--day=${DAYS + 1}`])).toThrow(/--day needs an integer/);
    });

    it("rejects an unknown flag", () => {
      expect(() => parsePlayArgs(["--nope"])).toThrow(/Unknown argument/);
      expect(() => parsePlayArgs(["--nope=1"])).toThrow(/Unknown argument/);
    });
  });
});
