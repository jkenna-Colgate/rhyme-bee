/**
 * Pure logic for the wayfinder chores (#244): reading a map's frontier off the
 * GitHub API's JSON, and adding one line to a section of a map's body. Nothing
 * here touches the network; `wayfinder.ts` is the shell that fetches and writes,
 * and it reaches GitHub through the `WayfinderGitHub` port so the orchestration
 * can be exercised against a fake.
 */

/** A sub-issue as `GET /issues/{map}/sub_issues` returns it, trimmed to what is read. */
export interface MapChild {
  number: number;
  title: string;
  state: string;
  labels: { name: string }[];
  assignees: { login: string }[];
  issue_dependencies_summary?: { blocked_by: number };
}

/** An issue as `GET /issues/{n}/dependencies/blocked_by` returns it, trimmed. */
export interface BlockerIssue {
  number: number;
  title: string;
  state: string;
}

const TICKET_TYPES = ["research", "prototype", "grilling", "task"] as const;

/** A wayfinder ticket's kind, read off its label; `unknown` when no label names one. */
export type TicketType = (typeof TICKET_TYPES)[number] | "unknown";

export interface TakeableTicket extends Pick<MapChild, "number" | "title"> {
  type: TicketType;
}

export interface BlockedTicket extends TakeableTicket {
  /** The blockers still open: the reason the ticket is not takeable. */
  blockers: Pick<BlockerIssue, "number" | "title">[];
  assignees: string[];
}

export interface ClaimedTicket extends TakeableTicket {
  assignees: string[];
}

export interface Frontier {
  takeable: TakeableTicket[];
  blocked: BlockedTicket[];
  claimed: ClaimedTicket[];
}

const TYPE_PREFIX = "wayfinder:";

function ticketType(child: MapChild): TicketType {
  for (const { name } of child.labels) {
    const type = TICKET_TYPES.find((t) => name === TYPE_PREFIX + t);
    if (type !== undefined) return type;
  }
  return "unknown";
}

/**
 * Split a map's open children into takeable, blocked and claimed, each in map
 * order. `blockersOf` holds the blocked_by list for any child whose summary
 * reports an open blocker; a blocker the list shows closed does not count. A
 * child both blocked and claimed is listed as blocked, since the blocker is the
 * reason that outlasts the claim.
 */
export function classifyFrontier(
  children: MapChild[],
  blockersOf: Record<number, BlockerIssue[]>,
): Frontier {
  const frontier: Frontier = { takeable: [], blocked: [], claimed: [] };
  for (const child of children) {
    if (child.state !== "open") continue;
    const base: TakeableTicket = { number: child.number, type: ticketType(child), title: child.title };
    const assignees = child.assignees.map((a) => a.login);
    const blockers = (blockersOf[child.number] ?? [])
      .filter((b) => b.state === "open")
      .map((b) => ({ number: b.number, title: b.title }));
    if (blockers.length > 0) {
      frontier.blocked.push({ ...base, blockers, assignees });
    } else if (assignees.length > 0) {
      frontier.claimed.push({ ...base, assignees });
    } else {
      frontier.takeable.push(base);
    }
  }
  return frontier;
}

export interface Insertion {
  /** The new body, LF throughout. */
  body: string;
  /** The fetched body, LF throughout: what the diff is taken against. */
  before: string;
  /** How many CRLF endings the fetched body had, all now LF. */
  crlfNormalised: number;
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;

interface Heading {
  index: number;
  level: number;
  text: string;
}

/** Markdown headings in `lines`, skipping heading-shaped lines inside code fences. */
function headings(lines: string[]): Heading[] {
  const found: Heading[] = [];
  let fenced = false;
  lines.forEach((line, index) => {
    if (FENCE.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const match = HEADING.exec(line);
    if (match) found.push({ index, level: match[1]!.length, text: match[2]! });
  });
  return found;
}

/**
 * Add `line` at the end of the section under `heading`, after the section's
 * last non-blank line, and return the body with every line ending LF. The
 * heading may be given bare (`Decisions so far`) or with its hashes. Throws,
 * so nothing is written, when the heading is missing or appears more than once,
 * or when `line` is not a single line.
 */
export function insertLine(fetched: string, heading: string, line: string): Insertion {
  if (/[\r\n]/.test(line)) throw new Error("Decide adds one line; the line given spans several.");
  const crlfNormalised = fetched.split("\r\n").length - 1;
  const before = fetched.replace(/\r\n/g, "\n");
  const lines = before.split("\n");
  const wanted = heading.replace(/^#+\s*/, "").trim();

  const all = headings(lines);
  const matches = all.filter((h) => h.text === wanted);
  if (matches.length === 0) throw new Error(`The map has no heading "${wanted}"; nothing written.`);
  if (matches.length > 1) {
    throw new Error(`The heading "${wanted}" appears ${matches.length} times; nothing written.`);
  }
  const target = matches[0]!;
  const next = all.find((h) => h.index > target.index && h.level <= target.level);
  const end = next ? next.index : lines.length;

  // After the last non-blank line, so the blank before the next heading stays.
  // An empty section gets a blank under its heading first.
  let last = end - 1;
  while (last > target.index && lines[last]!.trim() === "") last--;
  lines.splice(last + 1, 0, ...(last === target.index ? ["", line] : [line]));
  return { body: lines.join("\n"), before, crlfNormalised };
}

const CONTEXT = 2;

/**
 * The changed run of lines between two LF bodies, as one hunk with two lines
 * of context: everything between the common prefix and the common suffix. A
 * Decide changes one run, so one hunk is the whole diff.
 */
export function lineDiff(before: string, after: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  if (prefix === a.length && prefix === b.length) return "(no change)";
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }
  const removed = a.slice(prefix, a.length - suffix);
  const added = b.slice(prefix, b.length - suffix);
  const lead = a.slice(Math.max(0, prefix - CONTEXT), prefix);
  const trail = b.slice(b.length - suffix, b.length - suffix + CONTEXT);
  return [
    `@@ line ${prefix + 1} @@`,
    ...lead.map((l) => `  ${l}`),
    ...removed.map((l) => `- ${l}`),
    ...added.map((l) => `+ ${l}`),
    ...trail.map((l) => `  ${l}`),
  ].join("\n");
}

/**
 * The GitHub calls the wayfinder chores make, so the shell can be swapped for a
 * fake. `writeBody` returns the body as GitHub stored it.
 */
export interface WayfinderGitHub {
  subIssues(map: number): MapChild[];
  blockedBy(issue: number): BlockerIssue[];
  issueBody(issue: number): string;
  writeBody(issue: number, body: string): string;
}

function describeTicket(t: TakeableTicket): string {
  return `  #${t.number} ${t.type}  ${t.title}`;
}

/** Fetch a map's children and print its frontier, then why the rest wait. */
export function runFrontier(gh: WayfinderGitHub, map: number): string {
  const children = gh.subIssues(map);
  const blockersOf: Record<number, BlockerIssue[]> = {};
  for (const c of children) {
    if (c.state === "open" && (c.issue_dependencies_summary?.blocked_by ?? 0) > 0) {
      blockersOf[c.number] = gh.blockedBy(c.number);
    }
  }
  const { takeable, blocked, claimed } = classifyFrontier(children, blockersOf);
  const out = [`Frontier of #${map}: ${takeable.length} takeable`];
  if (takeable.length === 0) out.push("  (none)");
  out.push(...takeable.map(describeTicket));
  if (blocked.length > 0) {
    out.push(`Blocked (${blocked.length}):`);
    for (const t of blocked) {
      const by = t.blockers.map((b) => `#${b.number} ${b.title}`).join("; ");
      const who = t.assignees.length > 0 ? `; assigned to ${t.assignees.join(", ")}` : "";
      out.push(`${describeTicket(t)}  [blocked by ${by}${who}]`);
    }
  }
  if (claimed.length > 0) {
    out.push(`Claimed (${claimed.length}):`);
    for (const t of claimed) out.push(`${describeTicket(t)}  [assigned to ${t.assignees.join(", ")}]`);
  }
  return out.join("\n");
}

export interface DecideArgs {
  map: number;
  section: string;
  line: string;
  dryRun?: boolean;
}

export type WayfinderArgs =
  | { command: "frontier"; map: number }
  | ({ command: "decide" } & DecideArgs);

export const USAGE = [
  "Usage:",
  "  npx tsx scripts/wayfinder.ts frontier <map>",
  "  npx tsx scripts/wayfinder.ts decide <map> --section <heading> --line <text> [--dry-run]",
].join("\n");

function parseIssue(token: string | undefined): number {
  const n = Number((token ?? "").replace(/^#/, ""));
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Expected an issue number, got "${token ?? ""}".\n${USAGE}`);
  return n;
}

/** Parse the command line; flags take a space-separated or `=` value. Throws on bad input. */
export function parseWayfinderArgs(argv: string[]): WayfinderArgs {
  const [command, mapToken, ...rest] = argv;
  if (command !== "frontier" && command !== "decide") throw new Error(USAGE);
  const map = parseIssue(mapToken);
  if (command === "frontier") {
    if (rest.length > 0) throw new Error(`Unexpected argument: ${rest[0]}\n${USAGE}`);
    return { command, map };
  }
  let section: string | undefined;
  let line: string | undefined;
  let dryRun = false;
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    const eq = token.indexOf("=");
    const flag = eq === -1 ? token : token.slice(0, eq);
    const value = () => (eq === -1 ? rest[++i] : token.slice(eq + 1));
    if (flag === "--section") section = value();
    else if (flag === "--line") line = value();
    else if (token === "--dry-run") dryRun = true;
    else throw new Error(`Unknown argument: ${token}\n${USAGE}`);
  }
  if (!section) throw new Error(`decide needs --section <heading>.\n${USAGE}`);
  if (!line) throw new Error(`decide needs --line <text>.\n${USAGE}`);
  return { command, map, section, line, ...(dryRun ? { dryRun } : {}) };
}

/**
 * Fetch the map's body, add the line to the section, print the diff, and write
 * the body back unless this is a dry run. Throws before writing when the
 * section cannot be found once. After writing, the stored body is compared
 * with the sent one ignoring line endings, so GitHub's own CRLF does not read
 * as a failed write.
 */
export function runDecide(gh: WayfinderGitHub, args: DecideArgs): string {
  const { body, before, crlfNormalised } = insertLine(gh.issueBody(args.map), args.section, args.line);
  const out = [lineDiff(before, body)];
  if (crlfNormalised > 0) out.push(`(${crlfNormalised} CRLF line endings normalised to LF)`);
  if (args.dryRun) {
    out.push(`Dry run: #${args.map} not written.`);
    return out.join("\n");
  }
  const stored = gh.writeBody(args.map, body).replace(/\r\n/g, "\n");
  if (stored !== body) {
    throw new Error(`#${args.map} was written, but the body GitHub returned does not match the one sent.`);
  }
  out.push(`Wrote #${args.map}.`);
  return out.join("\n");
}
