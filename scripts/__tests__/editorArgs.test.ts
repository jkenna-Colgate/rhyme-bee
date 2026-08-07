import { describe, expect, it } from "vitest";
import { parseEditorArgs, tomorrow } from "../editorArgs.ts";

describe("parseEditorArgs", () => {
  it("reads a bare command as tomorrow's Daily Puzzle", () => {
    // No date and no Seed. The thing the editor runs every night is the
    // shortest thing to type, and the script fills in tomorrow.
    expect(parseEditorArgs(["read"])).toEqual({ command: "read" });
  });

  it("refuses anything that is not a command", () => {
    expect(() => parseEditorArgs([])).toThrow(/Expected a command/);
    expect(() => parseEditorArgs(["reed"])).toThrow(/Expected a command/);
  });

  describe("space-separated form", () => {
    it("reads --date <iso>", () => {
      expect(parseEditorArgs(["read", "--date", "2026-08-20"])).toEqual({
        command: "read",
        date: "2026-08-20",
      });
    });

    it("reads --seed <word>", () => {
      expect(parseEditorArgs(["read", "--seed", "placeholder"])).toEqual({
        command: "read",
        seed: "placeholder",
      });
    });
  });

  describe("equals form (survives PowerShell's -- handling)", () => {
    it("reads --date=<iso>", () => {
      expect(parseEditorArgs(["read", "--date=2026-08-20"])).toEqual({
        command: "read",
        date: "2026-08-20",
      });
    });

    it("reads --seed=<word>", () => {
      expect(parseEditorArgs(["read", "--seed=placeholder"])).toEqual({
        command: "read",
        seed: "placeholder",
      });
    });
  });

  describe("a bare positional token", () => {
    it("reads an ISO date as the day to read", () => {
      expect(parseEditorArgs(["read", "2026-08-20"])).toEqual({
        command: "read",
        date: "2026-08-20",
      });
    });

    it("reads anything else as a Seed Word to audition", () => {
      expect(parseEditorArgs(["read", "placeholder"])).toEqual({
        command: "read",
        seed: "placeholder",
      });
    });
  });

  it("refuses a date that is not an ISO date", () => {
    expect(() => parseEditorArgs(["read", "--date=20th"])).toThrow(/ISO date/);
    expect(() => parseEditorArgs(["read", "--date"])).toThrow(/ISO date/);
  });

  it("refuses an empty Seed Word", () => {
    expect(() => parseEditorArgs(["read", "--seed="])).toThrow(/needs a word/);
  });

  it("refuses an unknown flag rather than ignoring it", () => {
    expect(() => parseEditorArgs(["read", "--tomorrow"])).toThrow(/Unknown argument/);
  });

  it("refuses a date and a Seed Word together", () => {
    // Two different questions: an audition has no date, so there is nothing
    // sensible to print for both at once.
    expect(() => parseEditorArgs(["read", "2026-08-20", "placeholder"])).toThrow(/not both/);
  });
});

describe("tomorrow", () => {
  it("is the day after the one given", () => {
    expect(tomorrow("2026-08-07")).toBe("2026-08-08");
  });

  it("rolls over a month end", () => {
    expect(tomorrow("2026-08-31")).toBe("2026-09-01");
  });

  it("rolls over a year end", () => {
    expect(tomorrow("2026-12-31")).toBe("2027-01-01");
  });

  it("knows a leap year from a common one", () => {
    expect(tomorrow("2028-02-28")).toBe("2028-02-29");
    expect(tomorrow("2027-02-28")).toBe("2027-03-01");
  });
});
