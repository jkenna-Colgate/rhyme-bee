/**
 * One run of the Tier moves from Session Records (#270): replayed records in,
 * the rows to append and the run report out, against the fixture index.
 */

import { describe, expect, it } from "vitest";
import { makeTestIndex } from "../../src/__fixtures__/index.ts";
import type { SessionRecord } from "../../src/sessionRecord.ts";
import { parseTierMoves } from "../../src/tierMoves.ts";
import { serialiseTierOverride } from "../../src/tierOverride.ts";
import { runTierMoves, type TierMovesRunInput } from "../tierMovesRun.ts";

const index = makeTestIndex();

/** A Session on the `ate` day that found `objurgate`, a Bonus Word at the fixture threshold. */
function record(id: number, submissions: string[] = ["late", "objurgate"]): SessionRecord {
  return {
    id: id.toString(16).padStart(32, "0"),
    date: "2026-11-02",
    seed: { word: "ate", rhymeKey: "EY T" },
    submissions,
    ended: false,
  };
}

function input(over: Partial<TierMovesRunInput>): TierMovesRunInput {
  return {
    records: [record(1), record(2)],
    openIndex: () => index,
    measured: new Map([["objurgate", 0.2]]),
    names: new Set(),
    overrides: "",
    moves: "",
    now: "2026-12-01T00:00:00.000Z",
    settings: { share: 0.2, reachabilityFloor: 0.1, fewestSessionsPerDay: 2 },
    ...over,
  };
}

describe("a run of the Tier moves", () => {
  it("moves a Bonus Word every Session found, and writes the row", () => {
    const run = runTierMoves(input({}));
    expect(parseTierMoves(run.rows)).toEqual(new Set(["objurgate"]));
    expect(run.report).toContain("  objurgate: 2 of 2 Sessions, lower bound 0.224");
  });

  it("runs on no records at all, opens no index, and reports that it moved nothing", () => {
    const run = runTierMoves(
      input({
        records: [],
        openIndex: () => {
          throw new Error("opened");
        },
      }),
    );
    expect(run.rows).toBe("");
    expect(run.report).toContain("Moved nothing to Answer.");
    expect(run.report).toContain("No day under the Reachability floor.");
  });

  it("does not move a Bonus Word whose editor verdict is locked, and says why", () => {
    const run = runTierMoves(
      input({
        overrides: serialiseTierOverride({
          word: "objurgate",
          verdict: "bonus",
          measured: 0.2,
          decided: "2026-11-01T00:00:00.000Z",
          note: "",
          locked: true,
        }),
      }),
    );
    expect(run.rows).toBe("");
    expect(run.report.some((line) => line.startsWith("  objurgate: the editor's verdict is locked"))).toBe(true);
  });

  it("lists a day under the Reachability floor", () => {
    // Two Sessions that found one Answer each: nowhere near Laureate.
    const run = runTierMoves(input({}));
    expect(run.report).toContain("  2026-11-02: 0 of 2 Sessions reached Laureate (0.0%)");
  });
});
