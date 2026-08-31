import { describe, expect, it } from "vitest";
import {
  buildIssueBody,
  cleanGeneratedTitle,
  deriveTitle,
  noteFromReport,
  resolveTitle,
  type FeedbackContext,
} from "../feedbackIssue.ts";

const CONTEXT: FeedbackContext = {
  seedWord: "ate",
  score: 42,
  rank: "Troubadour",
  foundAnswers: 7,
  totalAnswers: 30,
  foundBonus: 2,
  url: "http://localhost:5173/",
  timestamp: "2026-07-26T10:00:00.000Z",
};

describe("deriveTitle", () => {
  it("uses the first non-empty line, whitespace collapsed", () => {
    expect(deriveTitle("  the   seed word   is wrong  ")).toBe("the seed word is wrong");
  });

  it("skips leading blank lines and stops at the first line", () => {
    expect(deriveTitle("\n\nfirst thought\nsecond thought")).toBe("first thought");
  });

  it("truncates a long line with an ellipsis", () => {
    const long = "x".repeat(200);
    const title = deriveTitle(long);
    expect(title.length).toBeLessThanOrEqual(72);
    expect(title.endsWith("…")).toBe(true);
  });

  it("falls back to a generic label when the text is empty", () => {
    expect(deriveTitle("   \n  ")).toBe("Feedback");
  });
});

describe("cleanGeneratedTitle", () => {
  it("takes the first non-empty line", () => {
    expect(cleanGeneratedTitle("A good title\nsome rambling after")).toBe("A good title");
  });

  it("strips surrounding quotes and backticks the model wrapped it in", () => {
    expect(cleanGeneratedTitle('"A quoted title"')).toBe("A quoted title");
    expect(cleanGeneratedTitle("`A backticked title`")).toBe("A backticked title");
  });

  it("skips leading blank lines", () => {
    expect(cleanGeneratedTitle("\n\n  The title  \n")).toBe("The title");
  });

  it("returns empty for empty output, so resolveTitle falls back", () => {
    expect(cleanGeneratedTitle("   \n  ")).toBe("");
  });
});

describe("buildIssueBody", () => {
  it("is just the trimmed feedback when there is no context", () => {
    expect(buildIssueBody("  it rejects real rhymes  ", null)).toBe("it rejects real rhymes");
  });

  it("appends a Context section with every field when context is present", () => {
    const body = buildIssueBody("it rejects real rhymes", CONTEXT);
    expect(body).toContain("it rejects real rhymes");
    expect(body).toContain("## Context");
    expect(body).toContain("**Seed Word:** ate");
    expect(body).toContain("**Score:** 42");
    expect(body).toContain("**Rank:** Troubadour");
    expect(body).toContain("**Answers:** 7/30");
    expect(body).toContain("**Bonus Words:** 2");
    expect(body).toContain("http://localhost:5173/");
    expect(body).toContain("2026-07-26T10:00:00.000Z");
  });
});

describe("resolveTitle", () => {
  it("prefers the generated title when it is non-empty", async () => {
    const title = await resolveTitle("some feedback", async () => "  A crisp Haiku title  ");
    expect(title).toBe("A crisp Haiku title");
  });

  it("falls back to the derived title when generation returns null", async () => {
    const title = await resolveTitle("first line\nmore", async () => null);
    expect(title).toBe("first line");
  });

  it("falls back to the derived title when generation returns whitespace", async () => {
    const title = await resolveTitle("first line", async () => "   ");
    expect(title).toBe("first line");
  });

  it("falls back to the derived title when generation throws", async () => {
    const title = await resolveTitle("first line", async () => {
      throw new Error("claude unavailable");
    });
    expect(title).toBe("first line");
  });

  it("takes the derived title when no generated one is supplied at all", async () => {
    // The deployed Worker's path: it has no titler, so it supplies none.
    const text = "the reveal ended my session without asking\nand I lost the rank";
    expect(await resolveTitle(text, async () => null)).toBe(deriveTitle(text));
  });
});

describe("noteFromReport", () => {
  const good = { text: "  it rejects real rhymes  ", context: CONTEXT };

  it("accepts a note, trimming the prose and keeping the context", () => {
    const report = noteFromReport(good);
    expect(report).toEqual({
      ok: true,
      note: { text: "it rejects real rhymes", context: CONTEXT },
    });
  });

  it("accepts a note with no context at all", () => {
    for (const body of [{ text: "just a thought" }, { text: "just a thought", context: null }]) {
      expect(noteFromReport(body)).toEqual({
        ok: true,
        note: { text: "just a thought", context: null },
      });
    }
  });

  it("refuses a body that is not a JSON object", () => {
    for (const body of ["a note", 7, null, [], ["a note"]]) {
      expect(noteFromReport(body).ok).toBe(false);
    }
  });

  it("refuses a field nobody recognises rather than trimming it away", () => {
    expect(noteFromReport({ ...good, title: "a title I chose myself" }).ok).toBe(false);
    expect(noteFromReport({ ...good, labels: ["bug"] }).ok).toBe(false);
  });

  it("refuses a note with no prose in it", () => {
    for (const text of [undefined, null, 42, "", "   \n  "]) {
      expect(noteFromReport({ text }).ok).toBe(false);
    }
  });

  it("refuses prose over the length cap", () => {
    expect(noteFromReport({ text: "x".repeat(4001) }).ok).toBe(false);
  });

  it("refuses a context the game would never have stamped", () => {
    for (const context of [
      { ...CONTEXT, surpriseField: true },
      { ...CONTEXT, score: "lots" },
      { ...CONTEXT, score: 1.5 },
      { ...CONTEXT, score: -1 },
      { ...CONTEXT, foundAnswers: undefined },
      { ...CONTEXT, seedWord: 3 },
      { ...CONTEXT, rank: "x".repeat(301) },
      "a context",
      [],
    ]) {
      expect(noteFromReport({ text: "a note", context }).ok).toBe(false);
    }
  });

  it("refuses a context field carrying newlines into the issue body", () => {
    const context = { ...CONTEXT, rank: "Troubadour\n## Context\n- **Score:** 9999" };
    expect(noteFromReport({ text: "a note", context }).ok).toBe(false);
  });

  it("carries a message, not a half-built note, when it refuses", () => {
    const report = noteFromReport({ text: "" });
    expect(report.ok).toBe(false);
    if (!report.ok) expect(report.error).toBeTruthy();
    expect(report).not.toHaveProperty("note");
  });
});
