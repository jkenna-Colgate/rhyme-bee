/**
 * What the status readout *means*, apart from the transport that carries it and
 * the `git` and `stat` calls it is derived from (#162).
 *
 * Three of the decisions under test are translations — an absolute path into a
 * repo-relative one, a porcelain code into a state, a state into whether Submit
 * is enabled — and a translation exercised only through a live subprocess is a
 * translation nobody can write a failing case for. The transport around them is
 * `web/__tests__/editorStatusEndpoint.test.ts`, which is also where the real
 * `git` is driven, against a repository built for the purpose.
 */

import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { IndexStaleness } from "../../scripts/indexArtifact.ts";
import { indexStatus, porcelainCodes, writtenStatus } from "../editorStatusReport.ts";
import {
  WRITTEN_FILES,
  WRITTEN_GROUPS,
  pendingWork,
  type EditorStatus,
} from "../src/editor/status.ts";

const ROOT = resolve("/repo");

describe("the files the pass is accountable for", () => {
  /**
   * #162 names "the Retrieval override layer, the demotion list, and the
   * pronunciation supplement with its deferred queue" — three groups over four
   * paths — and #178 adds the standing Declines as a fourth group of one. Held
   * here because the arithmetic is the part a reader is most likely to think is
   * a slip, and because the ticket's "each of the written files" is met by
   * headings rather than by paths.
   */
  it("is four groups over five paths", () => {
    expect(WRITTEN_GROUPS).toHaveLength(4);
    expect(WRITTEN_FILES).toEqual([
      "data/tier-overrides.csv",
      "data/demotions.txt",
      "data/declines.txt",
      "data/supplement.dict",
      "data/deferred-readings.jsonl",
    ]);
  });

  /**
   * The one a Decline writes, and the one this list is most easily read as not
   * needing: a Decline changes no verdict and cannot make the built Rhyme Index
   * stale. What this list answers is which files the pass must *commit*, and
   * `data/declines.txt` is hand-written, derived from nothing, and the only
   * record that a Candidate was ever considered and rejected (#178).
   */
  it("names the standing Declines, which nothing can regenerate", () => {
    expect(WRITTEN_FILES).toContain("data/declines.txt");
  });

  /**
   * The reviewed schedule artifact is hand-edited and is not this tool's to
   * write, so it is not this tool's to report on either — a status line about a
   * file the pass never touches would invite the reading that it might.
   */
  it("does not name the schedule, which the pass never writes", () => {
    expect(WRITTEN_FILES).not.toContain("data/schedule.json");
  });

  it("names every path exactly once, so no file gets two states on one screen", () => {
    expect(new Set(WRITTEN_FILES).size).toBe(WRITTEN_FILES.length);
  });
});

describe("naming the input that made the index stale", () => {
  const staleness = (input: string): IndexStaleness => ({
    stale: true,
    reason: "input-newer",
    input,
  });

  /**
   * The leak this translation exists to close. `indexStaleness` answers with an
   * absolute path because its callers open the file; on the maintainer's
   * machine that path begins with their home directory and their username, and
   * this value is read by a browser over a socket.
   */
  it("strips the repo root, so no home directory reaches the browser", () => {
    const status = indexStatus(staleness(resolve(ROOT, "data/tier-overrides.csv")), ROOT);

    expect(status.input).toBe("data/tier-overrides.csv");
  });

  it("normalises Windows separators, so the path reads the same on both platforms", () => {
    const status = indexStatus(staleness(resolve(ROOT, "src/normalise.ts")), ROOT);

    expect(status.input).toBe("src/normalise.ts");
    expect(status.input).not.toContain("\\");
  });

  /**
   * Cannot happen — `indexInputs` builds every path by resolving against the
   * root it was given — which is exactly why the branch is cheap to take. A run
   * of `../` segments says nothing useful and describes the machine's directory
   * tree.
   */
  it("drops a path outside the root rather than relaying a run of ../", () => {
    expect(indexStatus(staleness(resolve(ROOT, "../elsewhere/data.csv")), ROOT).input).toBeNull();
  });

  it("carries no input when no input settled it", () => {
    expect(indexStatus({ stale: true, reason: "no-artifact" }, ROOT)).toEqual({
      stale: true,
      reason: "no-artifact",
      input: null,
    });
    expect(indexStatus({ stale: false, reason: null }, ROOT)).toEqual({
      stale: false,
      reason: null,
      input: null,
    });
  });
});

describe("reading what git said", () => {
  it("takes the two-letter code and the path from each line", () => {
    const codes = porcelainCodes(" M data/demotions.txt\n?? data/tier-overrides.csv\n");

    expect(codes.get("data/demotions.txt")).toBe(" M");
    expect(codes.get("data/tier-overrides.csv")).toBe("??");
  });

  it("takes the new path of a rename, which is the path the tool writes", () => {
    const codes = porcelainCodes("R  data/old.txt -> data/demotions.txt\n");

    expect(codes.get("data/demotions.txt")).toBe("R ");
  });

  /**
   * The command is given an explicit pathspec, so there should be none. A
   * status readout is not the place to start reporting on files nobody asked
   * about, and a stray line is more likely to be a git version's extra output
   * than a file the editor wants to hear about.
   */
  it("drops lines naming a file the tool does not write", () => {
    expect(porcelainCodes(" M src/session.ts\n\n").size).toBe(0);
  });

  it("reads CRLF output, which is what git prints through a Windows pipe", () => {
    expect(porcelainCodes(" M data/demotions.txt\r\n").get("data/demotions.txt")).toBe(" M");
  });
});

describe("what each written file's state is", () => {
  const present = new Set(["data/demotions.txt", "data/supplement.dict"]);
  const stateOf = (statuses: ReturnType<typeof writtenStatus>, path: string) =>
    statuses.find((file) => file.path === path)?.state;

  it("answers a file git named as uncommitted, whatever the code", () => {
    const codes = new Map([
      ["data/demotions.txt", " M"],
      ["data/supplement.dict", "A "],
    ]);
    const statuses = writtenStatus(codes, present);

    expect(stateOf(statuses, "data/demotions.txt")).toBe("uncommitted");
    expect(stateOf(statuses, "data/supplement.dict")).toBe("uncommitted");
  });

  it("answers clean for a file that exists and that git said nothing about", () => {
    expect(stateOf(writtenStatus(new Map(), present), "data/demotions.txt")).toBe("clean");
  });

  /**
   * A resting state rather than a problem: ADR-0015 fixes a missing override
   * layer as a legitimate no-op, the same standing an empty one has, and
   * `OPTIONAL_DATA_INPUTS` carves the staleness predicate around the same fact.
   */
  it("answers absent for a file no pass has written yet", () => {
    expect(stateOf(writtenStatus(new Map(), present), "data/tier-overrides.csv")).toBe("absent");
  });

  /**
   * The case this state was added for. `data/tier-overrides.csv` matched the
   * repository's blanket `*.csv` rule until #162, so the one file that can
   * never be regenerated was invisible to every `git add` the maintainer would
   * ever type. Folding it into "uncommitted" would have advised a commit that
   * silently does nothing.
   */
  it("answers ignored for a file git has been told not to see", () => {
    const codes = new Map([["data/tier-overrides.csv", "!!"]]);

    expect(stateOf(writtenStatus(codes, new Set()), "data/tier-overrides.csv")).toBe("ignored");
  });

  /**
   * The most important line in the module. The tempting shorthand is "no
   * porcelain line means nothing to commit", and under a git that could not be
   * asked at all that shorthand reports a night of unsaved Retrieval judgements
   * as safely committed.
   */
  it("answers unknown for every file when git could not be asked", () => {
    const statuses = writtenStatus(null, present);

    expect(statuses.map((file) => file.state)).toEqual(WRITTEN_FILES.map(() => "unknown"));
  });

  it("answers for every written path, in the order the screen groups them", () => {
    expect(writtenStatus(new Map(), present).map((file) => file.path)).toEqual([...WRITTEN_FILES]);
  });
});

describe("what enables Submit", () => {
  const status = (stale: boolean): EditorStatus => ({
    index: { stale, reason: stale ? "input-newer" : null, input: null },
    written: [],
  });

  it("is enabled by a queued add, as it was before", () => {
    expect(pendingWork(1, status(false))).toBe(true);
  });

  /**
   * #162's widening, and the ticket's central promise: a night of Tier
   * judgements alone can be made real without adding a word first. Before this
   * the only routes to the rebuild were queueing a word the day did not need,
   * or leaving the tool for a terminal.
   */
  it("is enabled by a stale index with nothing queued", () => {
    expect(pendingWork(0, status(true))).toBe(true);
  });

  /**
   * What the old rule was protecting, still protected: an empty Submit against
   * a current artifact folds in nothing and costs the whole rebuild.
   */
  it("is disabled when nothing is queued and the index holds everything", () => {
    expect(pendingWork(0, status(false))).toBe(false);
  });

  /**
   * The conservative direction. At worst it leaves Submit disabled for the few
   * milliseconds before the first status lands; the reverse would enable a
   * rebuild on a guess.
   */
  it("treats a status that has not arrived as nothing pending", () => {
    expect(pendingWork(0, null)).toBe(false);
    expect(pendingWork(2, null)).toBe(true);
  });

  /**
   * The review finding this closes: `pendingWork` used to read `stale` on its
   * own, which lit Submit up for `no-artifact` and `missing-input` too — the
   * two reasons `StatusView`'s `IndexLine` says, correctly, that Submit's
   * rebuild cannot answer ("Submit's rebuild cannot supply it" for a missing
   * input; a day cannot even be read at all while no artifact exists, so the
   * combination could only be reached by a status racing an artifact deleted
   * out from under a day already on screen). Neither is "rows written since
   * the last rebuild", which is the one thing this button's click actually
   * folds in — so with nothing queued, only `input-newer` counts as pending.
   */
  it("is not enabled by a staleness reason its own rebuild cannot answer", () => {
    const stale = (reason: "no-artifact" | "missing-input"): EditorStatus => ({
      index: { stale: true, reason, input: reason === "missing-input" ? "data/words.txt" : null },
      written: [],
    });

    expect(pendingWork(0, stale("no-artifact"))).toBe(false);
    expect(pendingWork(0, stale("missing-input"))).toBe(false);
  });

  /** A queued add still wins regardless of why the index is stale, or isn't. */
  it("is enabled by a queued add over an unanswerable staleness reason too", () => {
    const status: EditorStatus = { index: { stale: true, reason: "no-artifact", input: null }, written: [] };

    expect(pendingWork(1, status)).toBe(true);
  });
});
