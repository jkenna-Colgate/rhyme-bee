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

  describe("equals form (parsed identically to the space form)", () => {
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

describe("parseEditorArgs for the add command", () => {
  it("takes several words in one invocation", () => {
    // A night's findings should be one command.
    expect(parseEditorArgs(["add", "--words=placeholder,toothache"])).toEqual({
      command: "add",
      words: ["placeholder", "toothache"],
    });
  });

  it("takes bare words when the shell lets them through", () => {
    expect(parseEditorArgs(["add", "placeholder", "toothache"])).toEqual({
      command: "add",
      words: ["placeholder", "toothache"],
    });
  });

  it("defaults to tomorrow's Rhyme Key by naming no date", () => {
    expect(parseEditorArgs(["add", "--words=earache"]).date).toBeUndefined();
  });

  it("takes an explicit date to add against that day's Rhyme Key", () => {
    expect(parseEditorArgs(["add", "--words=earache", "--date=2026-08-20"])).toEqual({
      command: "add",
      words: ["earache"],
      date: "2026-08-20",
    });
  });

  it("takes an explicit Rhyme Key, which the readout prints for the purpose", () => {
    expect(parseEditorArgs(["add", "--words=earache", "--rhymeKey=EY K"])).toEqual({
      command: "add",
      words: ["earache"],
      rhymeKey: "EY K",
    });
  });

  it("upper-cases a Rhyme Key rather than failing on its case", () => {
    expect(parseEditorArgs(["add", "--words=earache", "--rhymeKey=ey k"]).rhymeKey).toBe("EY K");
  });

  it("refuses an add that names no word", () => {
    expect(() => parseEditorArgs(["add"])).toThrow(/at least one word/);
    expect(() => parseEditorArgs(["add", "--words="])).toThrow(/at least one word/);
  });

  it("refuses a date and a Rhyme Key together", () => {
    // The date resolves to a key, so two ways of naming the target can only
    // disagree with each other.
    expect(() =>
      parseEditorArgs(["add", "--words=earache", "--date=2026-08-20", "--rhymeKey=EY K"]),
    ).toThrow(/not both/);
  });

  it("refuses something that is not a Rhyme Key", () => {
    expect(() => parseEditorArgs(["add", "--words=earache", "--rhymeKey=EY1 K"])).toThrow(
      /needs a Rhyme Key/,
    );
  });

  it("keeps the two commands' flags apart", () => {
    expect(() => parseEditorArgs(["read", "--words=earache"])).toThrow(/belong to `add`/);
    expect(() => parseEditorArgs(["read", "--rhymeKey=EY K"])).toThrow(/belong to `add`/);
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
