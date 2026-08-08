/**
 * The Retrieval override layer (ADR-0015): the puzzles editor setting a word's
 * Tier by name, over the measured prevalence the split is otherwise drawn from.
 *
 * Word prevalence measures *recognition*; the game needs **Retrieval**. The two
 * come apart maximally on transparent prefix compounds, and as a ranking
 * inversion rather than a miscalibrated line — prevalence ranks `misadjust`
 * above `readjust` — so no threshold anywhere on the scale can close it and only
 * a per-word lever can.
 *
 * Everything here is pure. The file IO, the build wiring and the editor that
 * writes the rows live elsewhere.
 */

import { describe, expect, it } from "vitest";
import {
  VERDICT_VALUE,
  applyTierOverrides,
  checkTierSentinels,
  parseTierOverrides,
  resolveTierOverrides,
  serialiseTierOverride,
  verdictForValue,
  type TierOverrideRow,
} from "../tierOverride.ts";
import { DEFAULT_SCORING_CONFIG, isRare } from "../scoring.ts";
import { tierFor } from "../verdict.ts";

/** The shipped build's threshold — an Answer is a word about half of people know. */
const THRESHOLD = 0.0;

function row(over: Partial<TierOverrideRow> = {}): TierOverrideRow {
  return {
    word: "counterthrust",
    verdict: "bonus",
    measured: 1.2119,
    decided: "2026-08-08T21:00:00.000Z",
    note: "",
    ...over,
  };
}

describe("the four verdicts", () => {
  it("compiles each verdict to the value ADR-0015 fixed it at", () => {
    expect(VERDICT_VALUE.bonus).toBe(-3.0);
    expect(VERDICT_VALUE["answer-rare"]).toBe(0.6);
    expect(VERDICT_VALUE["answer-common"]).toBe(3.0);
  });

  it("parses a value back to the verdict that produced it", () => {
    expect(verdictForValue(-3.0)).toBe("bonus");
    expect(verdictForValue(0.6)).toBe("answer-rare");
    expect(verdictForValue(3.0)).toBe("answer-common");
  });

  it("does not claim a measured prevalence as one of its own sentinels", () => {
    expect(verdictForValue(1.2119)).toBeNull();
    expect(verdictForValue(0.7638)).toBeNull();
  });

  it("has no value for `none`, because `none` withdraws rather than sets", () => {
    // Withdrawal and reversal are different acts: "undoing" with answer-common
    // would pin the word to +3.0 and silently strip the rare bonus from a word
    // that measured below the cutoff.
    expect(VERDICT_VALUE).not.toHaveProperty("none");
  });
});

describe("parseTierOverrides", () => {
  it("reads a row's five columns", () => {
    const rows = parseTierOverrides(
      "word,verdict,measured,decided,note\n" +
        "counterthrust,bonus,1.2119,2026-08-08T21:00:00.000Z,no player retrieves this\n",
    );

    expect(rows).toEqual([
      {
        word: "counterthrust",
        verdict: "bonus",
        measured: 1.2119,
        decided: "2026-08-08T21:00:00.000Z",
        note: "no player retrieves this",
      },
    ]);
  });

  it("reads an empty measured column as absent rather than as zero", () => {
    // A word with no prevalence row at all is a *lemmatiser coverage gap*; a
    // word whose measured value we disagree with is a dispute with the data.
    // Different populations, different remedies, so the file keeps them apart —
    // and zero is a real prevalence, sitting exactly on the Answer threshold.
    const [parsed] = parseTierOverrides("word,verdict,measured,decided,note\nbolder,answer-rare,,2026-08-08T21:00:00.000Z,\n");

    expect(parsed!.measured).toBeNull();
    expect(parsed!.measured).not.toBe(0);
  });

  it("keeps a note containing a comma whole", () => {
    const [parsed] = parseTierOverrides(
      'word,verdict,measured,decided,note\nreadjust,answer-common,0.7638,2026-08-08T21:00:00.000Z,"ranked below misadjust, which is the inversion"\n',
    );

    expect(parsed!.note).toBe("ranked below misadjust, which is the inversion");
  });

  it("ignores blank lines and the column header", () => {
    expect(parseTierOverrides("word,verdict,measured,decided,note\n\n\n")).toEqual([]);
    expect(parseTierOverrides("")).toEqual([]);
  });

  it("keeps every row for a word, in file order, rather than collapsing them", () => {
    const rows = parseTierOverrides(
      "word,verdict,measured,decided,note\n" +
        "counterthrust,bonus,1.2119,2026-08-08T21:00:00.000Z,\n" +
        "counterthrust,none,1.2119,2026-08-09T21:00:00.000Z,\n",
    );

    expect(rows.map((r) => r.verdict)).toEqual(["bonus", "none"]);
  });

  it("throws on a verdict outside the closed set", () => {
    // The same reasoning the demotion list parses by: a typo that was skipped
    // would leave a word silently at the Tier this file exists to correct.
    expect(() =>
      parseTierOverrides("word,verdict,measured,decided,note\ncounterthrust,bonus-word,1.2,2026-08-08,\n"),
    ).toThrow(/bonus-word/);
  });

  it("throws on a measured column that is neither empty nor a number", () => {
    expect(() =>
      parseTierOverrides("word,verdict,measured,decided,note\ncounterthrust,bonus,unknown,2026-08-08,\n"),
    ).toThrow(/measured/i);
  });
});

describe("serialiseTierOverride", () => {
  it("round-trips a row through the parser", () => {
    const original = row({ note: "a reader decodes it; a player never produces it" });

    expect(parseTierOverrides(serialiseTierOverride(original))).toEqual([original]);
  });

  it("round-trips an absent measured value as absent", () => {
    const original = row({ word: "bolder", verdict: "answer-rare", measured: null });

    expect(parseTierOverrides(serialiseTierOverride(original))[0]!.measured).toBeNull();
  });

  it("round-trips a note carrying a comma and a quote", () => {
    const original = row({ note: 'ranked above `readjust`, which is "backwards"' });

    expect(parseTierOverrides(serialiseTierOverride(original))[0]!.note).toBe(original.note);
  });

  it("stays one line when the note carries a newline, so parse can still read it back", () => {
    // The file is read line-by-line and appended to a line at a time, and the
    // note is whatever the editor typed into a browser. A row spanning two lines
    // would be a row the parser could not read back.
    const line = serialiseTierOverride(row({ note: "a reader decodes it\nno player produces it" }));

    expect(line.trimEnd().split("\n")).toHaveLength(1);
    expect(parseTierOverrides(line)[0]!.note).toBe("a reader decodes it no player produces it");
  });

  it("emits one newline-terminated line, so appending cannot corrupt what is written", () => {
    const line = serialiseTierOverride(row());

    expect(line.endsWith("\n")).toBe(true);
    expect(line.trimEnd().split("\n")).toHaveLength(1);
  });

  it("appends to an existing file without disturbing the rows already there", () => {
    const first = row({ word: "counterthrust", verdict: "bonus" });
    const second = row({ word: "readjust", verdict: "answer-common", measured: 0.7638 });

    const file = serialiseTierOverride(first) + serialiseTierOverride(second);

    expect(parseTierOverrides(file)).toEqual([first, second]);
  });
});

describe("resolveTierOverrides", () => {
  it("takes the last row for a word", () => {
    const rows = [
      row({ verdict: "bonus" }),
      row({ verdict: "answer-rare", decided: "2026-08-09T21:00:00.000Z" }),
    ];

    expect(resolveTierOverrides(rows).get("counterthrust")!.verdict).toBe("answer-rare");
  });

  it("resolves a withdrawal to `none`, so prevalence governs again", () => {
    const rows = [row({ verdict: "bonus" }), row({ verdict: "none" })];

    expect(resolveTierOverrides(rows).get("counterthrust")!.verdict).toBe("none");
  });

  it("flags a word carrying more than one row, so a reversal is never invisible", () => {
    const resolved = resolveTierOverrides([
      row({ word: "counterthrust", verdict: "bonus" }),
      row({ word: "counterthrust", verdict: "none" }),
      row({ word: "readjust", verdict: "answer-common" }),
    ]);

    expect(resolved.get("counterthrust")!.rows).toBe(2);
    expect(resolved.get("readjust")!.rows).toBe(1);
  });

  it("keeps the last row's measured value and note, not the first's", () => {
    const resolved = resolveTierOverrides([
      row({ measured: 1.2119, note: "first" }),
      row({ measured: null, note: "second" }),
    ]);

    expect(resolved.get("counterthrust")!.measured).toBeNull();
    expect(resolved.get("counterthrust")!.note).toBe("second");
  });
});

describe("applyTierOverrides", () => {
  function prevalence(entries: Record<string, number> = {}) {
    return { prevalence: new Map(Object.entries(entries)) };
  }

  it("patches an overridden word to its verdict's value", () => {
    const target = prevalence({ counterthrust: 1.2119 });
    applyTierOverrides(serialiseTierOverride(row({ verdict: "bonus" })), target);

    expect(target.prevalence.get("counterthrust")).toBe(-3.0);
  });

  it("leaves every untouched word alone", () => {
    const target = prevalence({ counterthrust: 1.2119, readjust: 0.7638, bust: 2.1 });
    applyTierOverrides(serialiseTierOverride(row({ verdict: "bonus" })), target);

    expect(target.prevalence.get("readjust")).toBe(0.7638);
    expect(target.prevalence.get("bust")).toBe(2.1);
    expect(target.prevalence.size).toBe(3);
  });

  it("gives a word with no prevalence row one, so a coverage gap can be tiered", () => {
    const target = prevalence({});
    applyTierOverrides(serialiseTierOverride(row({ word: "bolder", verdict: "answer-rare", measured: null })), target);

    expect(target.prevalence.get("bolder")).toBe(0.6);
  });

  it("patches nothing for `none`, leaving the measured value in place", () => {
    const target = prevalence({ counterthrust: 1.2119 });
    applyTierOverrides(
      serialiseTierOverride(row({ verdict: "bonus" })) + serialiseTierOverride(row({ verdict: "none" })),
      target,
    );

    expect(target.prevalence.get("counterthrust")).toBe(1.2119);
  });

  it("does not invent a prevalence row for a `none` on a word that had none", () => {
    const target = prevalence({});
    applyTierOverrides(serialiseTierOverride(row({ word: "bolder", verdict: "none" })), target);

    expect(target.prevalence.has("bolder")).toBe(false);
  });

  it("applies the last row when a word carries several", () => {
    const target = prevalence({ counterthrust: 1.2119 });
    applyTierOverrides(
      serialiseTierOverride(row({ verdict: "bonus" })) +
        serialiseTierOverride(row({ verdict: "answer-rare" })),
      target,
    );

    expect(target.prevalence.get("counterthrust")).toBe(0.6);
  });

  it("treats an empty file as the no-op it is", () => {
    const target = prevalence({ counterthrust: 1.2119 });
    applyTierOverrides("", target);

    expect(target.prevalence.get("counterthrust")).toBe(1.2119);
  });

  it("reports what it applied, so the build can say what the layer did", () => {
    const target = prevalence({ counterthrust: 1.2119 });
    const applied = applyTierOverrides(
      serialiseTierOverride(row({ verdict: "bonus" })) + serialiseTierOverride(row({ verdict: "bonus" })),
      target,
    );

    expect(applied).toEqual([
      { word: "counterthrust", verdict: "bonus", patched: -3.0, rows: 2, hadPrevalence: true },
    ]);
  });

  it("reports a word the prevalence data never held", () => {
    const target = prevalence({});
    const [applied] = applyTierOverrides(
      serialiseTierOverride(row({ word: "bolder", verdict: "answer-rare", measured: null })),
      target,
    );

    expect(applied!.hadPrevalence).toBe(false);
  });
});

describe("checkTierSentinels", () => {
  const shipped = { knownnessThreshold: THRESHOLD, scoring: DEFAULT_SCORING_CONFIG };

  it("passes under the shipped configuration", () => {
    expect(checkTierSentinels(shipped)).toEqual([]);
  });

  it("agrees with the engine's own rare line rather than restating it", () => {
    // The guard exists because a verdict's meaning depends on where two knobs
    // sit. It must read them the same way the engine does.
    expect(isRare(VERDICT_VALUE["answer-rare"], DEFAULT_SCORING_CONFIG)).toBe(true);
    expect(isRare(VERDICT_VALUE["answer-common"], DEFAULT_SCORING_CONFIG)).toBe(false);
  });

  it("agrees with the engine's own Answer/Bonus line rather than restating it", () => {
    // The other half of the same property. A guard carrying its own copy of
    // this comparison would keep passing if the comparison itself changed —
    // a blind spot exactly where the guard is meant to be loud.
    expect(tierFor(VERDICT_VALUE.bonus, THRESHOLD)).toBe("bonus");
    expect(tierFor(VERDICT_VALUE["answer-rare"], THRESHOLD)).toBe("answer");
    expect(tierFor(VERDICT_VALUE["answer-common"], THRESHOLD)).toBe("answer");
  });

  it("fails when the rare cutoff drops below the rare-Answer sentinel", () => {
    const faults = checkTierSentinels({
      knownnessThreshold: THRESHOLD,
      scoring: { ...DEFAULT_SCORING_CONFIG, rareKnownnessCutoff: 0.5 },
    });

    expect(faults).toHaveLength(1);
    expect(faults[0]!.verdict).toBe("answer-rare");
    expect(faults[0]!.knob).toBe("rareKnownnessCutoff");
  });

  it("fails when the knownness threshold rises past the rare-Answer sentinel", () => {
    // 0.6 is boxed: the Answer threshold below it, the rare cutoff above. It
    // clears a nudge to 0.5 deliberately and is guarded on both sides.
    const faults = checkTierSentinels({ knownnessThreshold: 1.0, scoring: DEFAULT_SCORING_CONFIG });

    expect(faults.some((f) => f.verdict === "answer-rare" && f.knob === "knownnessThreshold")).toBe(true);
  });

  it("clears a threshold nudged no further than ADR-0015 allows", () => {
    expect(checkTierSentinels({ knownnessThreshold: 0.5, scoring: DEFAULT_SCORING_CONFIG })).toEqual([]);
  });

  it("fails when the threshold drops below the Bonus sentinel", () => {
    const faults = checkTierSentinels({ knownnessThreshold: -4.0, scoring: DEFAULT_SCORING_CONFIG });

    expect(faults.some((f) => f.verdict === "bonus")).toBe(true);
  });

  it("names what it expected and what it got, so a moved knob reads as one", () => {
    const [fault] = checkTierSentinels({ knownnessThreshold: 4.0, scoring: DEFAULT_SCORING_CONFIG });

    expect(fault!.expected).toBeTruthy();
    expect(fault!.actual).toBeTruthy();
    expect(fault!.expected).not.toBe(fault!.actual);
  });
});
