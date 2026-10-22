import { describe, expect, it } from "vitest";
import {
  classifyFrontier,
  insertLine,
  lineDiff,
  parseWayfinderArgs,
  runDecide,
  runFrontier,
  type BlockerIssue,
  type MapChild,
  type WayfinderGitHub,
} from "../wayfinderMap.ts";

/** A sub-issue as the sub_issues endpoint returns it, trimmed to what is read. */
function child(
  number: number,
  over: Partial<MapChild> = {},
): MapChild {
  return {
    number,
    title: `Ticket ${number}`,
    state: "open",
    labels: [{ name: "wayfinder:grilling" }],
    assignees: [],
    issue_dependencies_summary: { blocked_by: 0 },
    ...over,
  };
}

describe("classifyFrontier", () => {
  it("keeps open, unblocked, unclaimed children in map order and drops closed ones", () => {
    const frontier = classifyFrontier(
      [child(248), child(219, { state: "closed" }), child(242), child(243)],
      {},
    );
    expect(frontier.takeable.map((t) => t.number)).toEqual([248, 242, 243]);
    expect(frontier.blocked).toEqual([]);
    expect(frontier.claimed).toEqual([]);
  });

  it("reads the type off the wayfinder label", () => {
    const frontier = classifyFrontier(
      [child(243, { labels: [{ name: "bug" }, { name: "wayfinder:research" }] })],
      {},
    );
    expect(frontier.takeable[0]).toEqual({ number: 243, type: "research", title: "Ticket 243" });
  });

  it("calls a child with no wayfinder label, or one it does not know, unknown", () => {
    const frontier = classifyFrontier(
      [child(244, { labels: [{ name: "bug" }] }), child(245, { labels: [{ name: "wayfinder:spike" }] })],
      {},
    );
    expect(frontier.takeable.map((t) => t.type)).toEqual(["unknown", "unknown"]);
  });

  it("lists a child with an open blocker under blocked, naming the open blockers only", () => {
    const frontier = classifyFrontier(
      [child(233, { issue_dependencies_summary: { blocked_by: 1 } })],
      {
        233: [
          { number: 234, title: "Closed one", state: "closed" },
          { number: 237, title: "Put the sheet to playtesters", state: "open" },
        ],
      },
    );
    expect(frontier.takeable).toEqual([]);
    expect(frontier.blocked).toEqual([
      {
        number: 233,
        type: "grilling",
        title: "Ticket 233",
        blockers: [{ number: 237, title: "Put the sheet to playtesters" }],
        assignees: [],
      },
    ]);
  });

  it("lists an assigned child under claimed with its assignee", () => {
    const frontier = classifyFrontier(
      [child(237, { assignees: [{ login: "jkenna-Colgate" }], labels: [{ name: "wayfinder:task" }] })],
      {},
    );
    expect(frontier.takeable).toEqual([]);
    expect(frontier.claimed).toEqual([
      { number: 237, type: "task", title: "Ticket 237", assignees: ["jkenna-Colgate"] },
    ]);
  });

  it("puts a child that is both blocked and claimed under blocked, keeping the assignee", () => {
    const frontier = classifyFrontier(
      [child(300, { assignees: [{ login: "a" }], issue_dependencies_summary: { blocked_by: 1 } })],
      { 300: [{ number: 301, title: "Blocker", state: "open" }] },
    );
    expect(frontier.claimed).toEqual([]);
    expect(frontier.blocked[0]?.assignees).toEqual(["a"]);
  });
});

const MAP = [
  "## Notes",
  "",
  "- a note",
  "",
  "## Decisions so far",
  "",
  "<!-- the index -->",
  "",
  "- [First](link): one",
  "- [Second](link): two",
  "",
  "## Not yet specified",
  "",
  "- open thing",
  "",
].join("\n");

describe("insertLine", () => {
  it("adds the line after the last entry of the named section", () => {
    const result = insertLine(MAP, "Decisions so far", "- [Third](link): three");
    expect(result.body).toBe(
      MAP.replace("- [Second](link): two\n", "- [Second](link): two\n- [Third](link): three\n"),
    );
  });

  it("accepts the heading with its hashes", () => {
    const result = insertLine(MAP, "## Decisions so far", "- x");
    expect(result.body).toContain("- [Second](link): two\n- x\n\n## Not yet specified");
  });

  it("writes LF whatever endings the fetched body had, and counts what it rewrote", () => {
    const crlf = MAP.replace(/\n/g, "\r\n");
    const result = insertLine(crlf, "Decisions so far", "- x");
    expect(result.body).not.toContain("\r");
    expect(result.body).toBe(insertLine(MAP, "Decisions so far", "- x").body);
    expect(result.crlfNormalised).toBe(14);
    expect(insertLine(MAP, "Decisions so far", "- x").crlfNormalised).toBe(0);
  });

  it("appends to the last section, which runs to the end of the body", () => {
    const result = insertLine(MAP, "Not yet specified", "- another");
    expect(result.body.endsWith("- open thing\n- another\n")).toBe(true);
  });

  it("ends the section at a heading of the same or higher level, not a deeper one", () => {
    const body = "## A\n\n- one\n\n### Sub\n\n- deep\n\n## B\n";
    expect(insertLine(body, "A", "- two").body).toBe(
      "## A\n\n- one\n\n### Sub\n\n- deep\n- two\n\n## B\n",
    );
  });

  it("puts the line under the heading, set off by a blank, when the section is empty", () => {
    const body = "## A\n\n## B\n";
    expect(insertLine(body, "A", "- one").body).toBe("## A\n\n- one\n\n## B\n");
  });

  it("refuses when the heading is missing", () => {
    expect(() => insertLine(MAP, "Decisions", "- x")).toThrow(/no heading "Decisions"/);
  });

  it("refuses when the heading appears more than once", () => {
    const body = `${MAP}\n## Notes\n\n- again\n`;
    expect(() => insertLine(body, "Notes", "- x")).toThrow(/appears 2 times/);
  });

  it("does not count a heading-shaped line inside a code fence", () => {
    const body = "## A\n\n```\n## A\n```\n\n- one\n";
    expect(insertLine(body, "A", "- two").body).toBe("## A\n\n```\n## A\n```\n\n- one\n- two\n");
  });

  it("refuses a line that is more than one line", () => {
    expect(() => insertLine(MAP, "Notes", "- x\n- y")).toThrow(/one line/);
  });
});

describe("lineDiff", () => {
  it("shows an inserted line as the only change, with context either side", () => {
    const before = "a\nb\nc\nd\ne\nf\n";
    const after = "a\nb\nc\nX\nd\ne\nf\n";
    expect(lineDiff(before, after)).toBe(["@@ line 4 @@", "  b", "  c", "+ X", "  d", "  e"].join("\n"));
  });

  it("shows a replaced line as one removal and one addition", () => {
    expect(lineDiff("a\nb\nc", "a\nB\nc")).toBe(["@@ line 2 @@", "  a", "- b", "+ B", "  c"].join("\n"));
  });

  it("says so when nothing changed", () => {
    expect(lineDiff("a\nb", "a\nb")).toBe("(no change)");
  });
});

/** A fake GitHub holding one map body and a set of children, recording writes. */
function fakeGitHub(opts: {
  body?: string;
  children?: MapChild[];
  blockers?: Record<number, BlockerIssue[]>;
  storeAs?: (sent: string) => string;
}) {
  const writes: { issue: number; body: string }[] = [];
  const blockerCalls: number[] = [];
  const gh: WayfinderGitHub = {
    subIssues: () => opts.children ?? [],
    blockedBy: (n) => {
      blockerCalls.push(n);
      return opts.blockers?.[n] ?? [];
    },
    issueBody: () => opts.body ?? "",
    writeBody: (issue, body) => {
      writes.push({ issue, body });
      return opts.storeAs ? opts.storeAs(body) : body;
    },
  };
  return { gh, writes, blockerCalls };
}

describe("runFrontier", () => {
  it("prints takeable, blocked and claimed children, fetching blockers only where the summary reports one", () => {
    const { gh, blockerCalls } = fakeGitHub({
      children: [
        child(219, { state: "closed", issue_dependencies_summary: { blocked_by: 1 } }),
        child(233, { title: "Where do Points stop?", issue_dependencies_summary: { blocked_by: 1 } }),
        child(237, {
          title: "Put the sheet to playtesters",
          labels: [{ name: "wayfinder:task" }],
          assignees: [{ login: "jkenna-Colgate" }],
        }),
        child(242, { title: "Do they land?" }),
        child(243, { title: "What breaks?", labels: [{ name: "wayfinder:research" }] }),
      ],
      blockers: { 233: [{ number: 237, title: "Put the sheet to playtesters", state: "open" }] },
    });
    expect(runFrontier(gh, 218)).toBe(
      [
        "Frontier of #218: 2 takeable",
        "  #242 grilling  Do they land?",
        "  #243 research  What breaks?",
        "Blocked (1):",
        "  #233 grilling  Where do Points stop?  [blocked by #237 Put the sheet to playtesters]",
        "Claimed (1):",
        "  #237 task  Put the sheet to playtesters  [assigned to jkenna-Colgate]",
      ].join("\n"),
    );
    expect(blockerCalls).toEqual([233]);
  });

  it("says when nothing is takeable", () => {
    const { gh } = fakeGitHub({ children: [] });
    expect(runFrontier(gh, 5)).toBe("Frontier of #5: 0 takeable\n  (none)");
  });
});

describe("runDecide", () => {
  const args = { map: 218, section: "Decisions so far", line: "- [Third](link): three" };

  it("writes the body with the line added, LF throughout, and prints a one-line diff", () => {
    const { gh, writes } = fakeGitHub({ body: MAP.replace(/\n/g, "\r\n") });
    const out = runDecide(gh, args);
    expect(writes).toEqual([{ issue: 218, body: insertLine(MAP, args.section, args.line).body }]);
    const changed = out.split("\n").filter((l) => /^[+-] /.test(l));
    expect(changed).toEqual(["+ - [Third](link): three"]);
    expect(out).toContain("14 CRLF line endings normalised to LF");
    expect(out).toContain("Wrote #218.");
  });

  it("prints the diff and writes nothing on a dry run", () => {
    const { gh, writes } = fakeGitHub({ body: MAP });
    const out = runDecide(gh, { ...args, dryRun: true });
    expect(writes).toEqual([]);
    expect(out).toContain("+ - [Third](link): three");
    expect(out).toContain("Dry run: #218 not written.");
  });

  it("writes nothing when the heading is missing", () => {
    const { gh, writes } = fakeGitHub({ body: MAP });
    expect(() => runDecide(gh, { ...args, section: "Decisions" })).toThrow(/no heading/);
    expect(writes).toEqual([]);
  });

  it("writes nothing when the heading is ambiguous", () => {
    const { gh, writes } = fakeGitHub({ body: `${MAP}\n## Decisions so far\n` });
    expect(() => runDecide(gh, args)).toThrow(/appears 2 times/);
    expect(writes).toEqual([]);
  });

  it("accepts a stored body that differs from the sent one only in line endings", () => {
    const { gh } = fakeGitHub({ body: MAP, storeAs: (sent) => sent.replace(/\n/g, "\r\n") });
    expect(runDecide(gh, args)).toContain("Wrote #218.");
  });

  it("parses frontier and decide invocations, in space and equals form", () => {
    expect(parseWayfinderArgs(["frontier", "#218"])).toEqual({ command: "frontier", map: 218 });
    expect(
      parseWayfinderArgs(["decide", "218", "--section", "Decisions so far", "--line=- [x](y): z", "--dry-run"]),
    ).toEqual({ command: "decide", map: 218, section: "Decisions so far", line: "- [x](y): z", dryRun: true });
  });

  it("refuses a decide missing its section or line, and an unknown command", () => {
    expect(() => parseWayfinderArgs(["decide", "218", "--line", "- x"])).toThrow(/--section/);
    expect(() => parseWayfinderArgs(["decide", "218", "--section", "A"])).toThrow(/--line/);
    expect(() => parseWayfinderArgs(["resolve", "218"])).toThrow(/Usage/);
    expect(() => parseWayfinderArgs(["frontier", "map"])).toThrow(/issue number/);
  });

  it("fails loudly when the stored body is not the one sent", () => {
    const { gh } = fakeGitHub({ body: MAP, storeAs: () => "something else" });
    expect(() => runDecide(gh, args)).toThrow(/does not match/);
  });
});
