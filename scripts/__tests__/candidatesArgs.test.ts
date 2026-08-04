/**
 * Pure parser for `npm run supplement:candidates` flags, in the style of
 * `playArgs.ts`: throws on invalid input rather than returning it, and accepts
 * both the space-separated and `=` forms.
 */

import { describe, expect, it } from "vitest";
import { parseCandidatesArgs } from "../candidatesArgs.ts";

describe("parseCandidatesArgs", () => {
  it("parses no flags to queue mode, not archiving", () => {
    expect(parseCandidatesArgs([])).toEqual({ archive: false, wordList: null });
  });

  it("reads --archive alone as queue mode with archiving", () => {
    expect(parseCandidatesArgs(["--archive"])).toEqual({ archive: true, wordList: null });
  });

  describe("word-list mode", () => {
    it("reads --words and --target together, space-separated", () => {
      expect(parseCandidatesArgs(["--words", "ule,rule,fluke", "--target", "UW L"])).toEqual({
        archive: false,
        wordList: { words: ["ule", "rule", "fluke"], target: "UW L" },
      });
    });

    it("reads --words= and --target= together, equals form", () => {
      expect(parseCandidatesArgs(["--words=ule,rule,fluke", "--target=UW L"])).toEqual({
        archive: false,
        wordList: { words: ["ule", "rule", "fluke"], target: "UW L" },
      });
    });

    it("trims whitespace and drops empty entries from the word list", () => {
      expect(parseCandidatesArgs(["--words", " ule , rule ,, fluke ", "--target", "UW L"])).toEqual({
        archive: false,
        wordList: { words: ["ule", "rule", "fluke"], target: "UW L" },
      });
    });

    it("parses the equals form identically to the space form", () => {
      expect(parseCandidatesArgs(["--words=ule,rule", "--target=UW L"])).toEqual(
        parseCandidatesArgs(["--words", "ule,rule", "--target", "UW L"]),
      );
    });
  });

  describe("validation", () => {
    it("rejects --words with no value", () => {
      expect(() => parseCandidatesArgs(["--words"])).toThrow(/--words needs a comma-separated list/);
    });

    it("rejects an empty --words= value", () => {
      expect(() => parseCandidatesArgs(["--words="])).toThrow(/--words needs a comma-separated list/);
    });

    it("rejects --target with no value", () => {
      expect(() => parseCandidatesArgs(["--words", "ule", "--target"])).toThrow(/--target needs a Rhyme Key/);
    });

    it("rejects --words supplied without --target", () => {
      expect(() => parseCandidatesArgs(["--words", "ule,rule"])).toThrow(/--words needs --target/);
    });

    it("rejects --target supplied without --words", () => {
      expect(() => parseCandidatesArgs(["--target", "UW L"])).toThrow(/--target needs --words/);
    });

    it("rejects --archive combined with --words/--target", () => {
      expect(() =>
        parseCandidatesArgs(["--archive", "--words", "ule,rule", "--target", "UW L"]),
      ).toThrow(/--archive only applies to the queue/);
    });

    it("rejects an unknown flag", () => {
      expect(() => parseCandidatesArgs(["--nope"])).toThrow(/Unknown argument/);
      expect(() => parseCandidatesArgs(["--nope=1"])).toThrow(/Unknown argument/);
    });
  });
});
