/**
 * What the status endpoint answers, decided apart from the transport that
 * carries it and the two facts it is decided from — the whole of #162's
 * judgement with none of its IO, so it can be tested without a dev server, a
 * built artifact or a git repository.
 *
 * The split `editorTierRequest.ts` and `editorAddRequest.ts` both make, and for
 * the same reason. It matters a little more here, because two of the three
 * decisions below are *translations* — an absolute path into a repo-relative
 * one, a porcelain code into a sentence-worth of state — and a translation that
 * is only exercised through a live `git` is a translation nobody can write a
 * failing case for.
 */

import { relative } from "node:path";
import type { IndexStaleness } from "../scripts/indexArtifact.ts";
import {
  WRITTEN_FILES,
  type IndexStatus,
  type WrittenFileState,
  type WrittenFileStatus,
} from "./src/editor/status.ts";

/**
 * The staleness predicate's answer, with the input named the way a browser can
 * be shown it.
 *
 * `indexStaleness` deals in absolute paths because its callers open the files.
 * This one is read over a socket, so the repo root is stripped and the
 * separators are normalised to forward slashes — on Windows the raw value is
 * `C:\Users\<name>\...\data\demotions.txt`, and the developer's username has no
 * business in a response body. What survives is `data/demotions.txt`, which is
 * the whole of what the sentence on screen needs.
 *
 * A path that somehow lies *outside* the root is dropped rather than relayed:
 * `relative` would answer with a run of `../` segments that says nothing useful
 * and leaks the shape of the machine's directory tree. It cannot happen —
 * `indexInputs` builds every path by resolving against the root it was given —
 * which is exactly why the branch is cheap to take.
 */
export function indexStatus(staleness: IndexStaleness, root: string): IndexStatus {
  return {
    stale: staleness.stale,
    reason: staleness.reason,
    input: staleness.input === undefined ? null : withinRoot(staleness.input, root),
  };
}

function withinRoot(path: string, root: string): string | null {
  const inside = relative(root, path).replaceAll("\\", "/");
  return inside === "" || inside.startsWith("../") ? null : inside;
}

/**
 * The `XY <path>` lines of `git status --porcelain --ignored` as a map from
 * path to its two-letter code.
 *
 * Parsed rather than pattern-matched, because the codes are the whole answer:
 * `!!` is a file git has been told to ignore and every other code is a file
 * with something uncommitted about it, and collapsing them at this stage would
 * lose the one distinction that matters most (see `writtenStatus`).
 *
 * A rename prints `R  old -> new`, and the path taken is the new one — the
 * question being asked is about a path the tool writes, and a rename that
 * produced it is a change to it. Lines that do not name a file the tool writes
 * are dropped: the command is given an explicit pathspec so there should be
 * none, and a status readout is not the place to start reporting on files
 * nobody asked about.
 */
export function porcelainCodes(output: string): Map<string, string> {
  const codes = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    if (line.length < 4) continue;
    const code = line.slice(0, 2);
    const named = line.slice(3);
    const path = (named.includes(" -> ") ? named.slice(named.indexOf(" -> ") + 4) : named)
      .replace(/^"|"$/g, "")
      .replaceAll("\\", "/");
    if (WRITTEN_FILES.includes(path)) codes.set(path, code);
  }
  return codes;
}

/**
 * Each written file's state, from what git said and what is on disk.
 *
 * `codes` is `null` when git could not be asked at all — not installed, not a
 * repository, killed on a timeout. Every file is then `unknown`, and that is
 * the single most important line in this module: the tempting shorthand is "no
 * porcelain line means nothing to commit", and under a failed `git` that
 * shorthand reports a night of unsaved Retrieval judgements as safely
 * committed. The two facts are told apart here so the screen can tell them
 * apart.
 *
 * With git answering, a file's own line settles it and silence means clean —
 * but only for a file that exists. A path with no line and no file is `absent`,
 * which is a real resting state rather than a problem: ADR-0015 fixes a missing
 * override layer as a legitimate no-op, the same standing an empty one has, and
 * `OPTIONAL_DATA_INPUTS` (`scripts/indexArtifact.ts`) carves the staleness
 * predicate around the same fact.
 */
export function writtenStatus(
  codes: Map<string, string> | null,
  present: ReadonlySet<string>,
): WrittenFileStatus[] {
  return WRITTEN_FILES.map((path) => ({ path, state: stateOf(path, codes, present) }));
}

function stateOf(
  path: string,
  codes: Map<string, string> | null,
  present: ReadonlySet<string>,
): WrittenFileState {
  if (codes === null) return "unknown";
  const code = codes.get(path);
  if (code === "!!") return "ignored";
  if (code !== undefined) return "uncommitted";
  return present.has(path) ? "clean" : "absent";
}
