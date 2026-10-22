/**
 * The two wayfinder chores every session used to script by hand (#244).
 * `--help` prints the usage; for PowerShell, see `docs/powershell.md`.
 *
 * Frontier lists a map's takeable children in map order, then the blocked and
 * claimed ones with the reason each waits. Decide adds one line to the end of a
 * named section of the map's body, prints the diff, and writes the body back
 * with LF endings; it writes nothing when the heading is missing or appears
 * twice. The same invocation runs from PowerShell and Git Bash: it calls `gh`
 * directly with no shell in between, and passes the body to `gh` on stdin, so
 * no temp file path is ever involved.
 *
 * The logic lives in `wayfinderMap.ts` and is tested there; this file is only
 * the `gh` adapter. `{owner}/{repo}` is filled in by `gh` from the checkout.
 */
import { spawnSync } from "node:child_process";
import {
  parseWayfinderArgs,
  USAGE,
  runDecide,
  runFrontier,
  type BlockerIssue,
  type MapChild,
  type WayfinderGitHub,
} from "./wayfinderMap.ts";

function gh(args: string[], input?: string): string {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...(input !== undefined ? { input } : {}),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`gh ${args.join(" ")} failed:\n${result.stderr.trim()}`);
  }
  return result.stdout;
}

const ISSUES = "repos/{owner}/{repo}/issues";

const github: WayfinderGitHub = {
  subIssues(map) {
    const pages = JSON.parse(
      gh(["api", "--paginate", "--slurp", `${ISSUES}/${map}/sub_issues?per_page=100`]),
    ) as MapChild[][];
    return pages.flat();
  },
  blockedBy(issue) {
    return JSON.parse(gh(["api", `${ISSUES}/${issue}/dependencies/blocked_by?per_page=100`])) as BlockerIssue[];
  },
  issueBody(issue) {
    return bodyOf(gh(["api", `${ISSUES}/${issue}`]));
  },
  writeBody(issue, body) {
    return bodyOf(
      gh(["api", "--method", "PATCH", `${ISSUES}/${issue}`, "--input", "-"], JSON.stringify({ body })),
    );
  },
};

/** The body of an issue as the API returns it, which is null for an empty one. */
function bodyOf(issueJson: string): string {
  return (JSON.parse(issueJson) as { body: string | null }).body ?? "";
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}

try {
  const args = parseWayfinderArgs(process.argv.slice(2));
  console.log(args.command === "frontier" ? runFrontier(github, args.map) : runDecide(github, args));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
