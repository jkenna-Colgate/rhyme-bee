/**
 * The pure core of the feedback button: what a jotted note is allowed to be, and
 * how one becomes a GitHub issue's title and body. No I/O lives here — the
 * impure shells around these functions are `../../feedbackPlugin.ts` in
 * development, which spawns `gh` and `claude`, and `../../worker/feedbackRoute.ts`
 * when deployed, which calls the GitHub API directly. Both file the same issue
 * from the same decisions, and both refuse the same notes, because the decisions
 * and the refusals are here.
 *
 * Nothing here adjudicates. A note is a report about a game already played in
 * the browser, never a request for a verdict (ADR-0013).
 */

import { hasOnlyFields, refuse, type Validated } from "../../../src/report.ts";

/** The live game context stamped onto a feedback issue, read at submit time. */
export interface FeedbackContext {
  seedWord: string;
  score: number;
  rank: string;
  foundAnswers: number;
  totalAnswers: number;
  foundBonus: number;
  url: string;
  timestamp: string;
}

const TITLE_MAX = 72;

/**
 * A fallback issue title derived from the feedback text itself: its first
 * non-empty line, whitespace-collapsed and truncated. Used whenever Haiku title
 * generation is unavailable or fails, so an issue is always filed rather than a
 * jotted thought being lost to an LLM hiccup.
 */
export function deriveTitle(text: string): string {
  const firstLine =
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  const collapsed = firstLine.replace(/\s+/g, " ").trim();
  if (collapsed === "") return "Feedback";
  if (collapsed.length <= TITLE_MAX) return collapsed;
  return collapsed.slice(0, TITLE_MAX - 1).trimEnd() + "…";
}

/**
 * The issue body: the raw feedback, followed by an auto-stamped Context section
 * when the session context is available. The context is what you'd otherwise
 * forget to write down — which Puzzle and state a note like "this should have
 * been accepted" was about.
 */
export function buildIssueBody(text: string, context: FeedbackContext | null): string {
  const feedback = text.trim();
  if (context === null) return feedback;
  return [
    feedback,
    "",
    "## Context",
    "",
    `- **Seed Word:** ${context.seedWord}`,
    `- **Score:** ${context.score}`,
    `- **Rank:** ${context.rank}`,
    `- **Answers:** ${context.foundAnswers}/${context.totalAnswers}`,
    `- **Bonus Words:** ${context.foundBonus}`,
    `- **URL:** ${context.url}`,
    `- **When:** ${context.timestamp}`,
  ].join("\n");
}

/**
 * Normalise a raw title as an LLM returned it: take its first non-empty line and
 * strip any surrounding quotes or backticks the model wrapped it in. May return
 * "" (e.g. empty output) — `resolveTitle` treats that as "no title" and falls
 * back. Lives here, beside `deriveTitle`, so the title decisions stay in one
 * tested place rather than leaking into the impure endpoint.
 */
export function cleanGeneratedTitle(raw: string): string {
  const firstLine =
    raw
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  return firstLine.replace(/^["'`]+|["'`]+$/g, "").trim();
}

/**
 * Resolve the issue title: prefer the generated (Haiku) title, but fall back to
 * `deriveTitle` on any failure or empty result, so filing never depends on the
 * LLM. `generate` is injected so this orchestration stays pure and testable.
 */
export async function resolveTitle(
  text: string,
  generate: () => Promise<string | null>,
): Promise<string> {
  try {
    const generated = (await generate())?.trim();
    if (generated) return generated;
  } catch {
    // Fall through to the derived title — a title is a nicety, never a gate.
  }
  return deriveTitle(text);
}

// --- Untrusted notes ---------------------------------------------------------

/**
 * The largest note body the deployed endpoint will read, in bytes. A note is
 * prose plus a fixed handful of stamped context fields; eight kilobytes is far
 * more than anyone types into a four-row textarea, and small enough that an
 * oversize body is cheap to refuse.
 */
export const MAX_NOTE_BYTES = 8192;

/** The fields a note may carry. Anything else is a refusal, not a shrug. */
const NOTE_FIELDS = new Set(["text", "context"]);

/** `FeedbackContext`'s single-line strings, and its counts. Exactly its fields. */
const CONTEXT_STRINGS = ["seedWord", "rank", "url", "timestamp"] as const;
const CONTEXT_COUNTS = ["score", "foundAnswers", "totalAnswers", "foundBonus"] as const;
const CONTEXT_FIELDS = new Set<string>([...CONTEXT_STRINGS, ...CONTEXT_COUNTS]);

const MAX_TEXT_LENGTH = 4000;
const MAX_CONTEXT_STRING_LENGTH = 300;
const MAX_COUNT = 1_000_000;

/** No newline and no other control character — every context field is one line. */
const SINGLE_LINE = /^[^\p{Cc}]*$/u;

/** A note as the endpoint will file it: the player's prose, and their context. */
export interface FeedbackNote {
  text: string;
  context: FeedbackContext | null;
}

/**
 * The outcome of reading an untrusted note: either a whole note or a refusal.
 * There is deliberately no third state — a caller cannot get half a note out of
 * this, so a refused one can never be half-filed. Shares its shape with
 * `CandidateReport` (`src/supplementCandidate.ts`) via `Validated`
 * (`src/report.ts`); only the fields of a note are specific to this module.
 */
export type NoteReport = Validated<"note", FeedbackNote>;

/**
 * Coerce an untrusted request body into a note, or refuse it.
 *
 * The body is whatever a public endpoint was sent, so every field is checked
 * rather than trusted. The prose is capped but otherwise left alone — it is the
 * whole point of the note, and it goes into an issue body, not a command line.
 * The context around it is not prose: it is a fixed set of values the game
 * stamped on, so each one is held to its type, its length and its single line,
 * and a field nobody recognises means the sender is not the game — so the whole
 * note goes, rather than being quietly trimmed to the parts we liked.
 *
 * A note with no context is legitimate and files as bare prose; a note with a
 * *malformed* context is not, because the game would never send one.
 */
export function noteFromReport(body: unknown): NoteReport {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return refuse("A note must be a JSON object.");
  }
  const report = body as Record<string, unknown>;

  if (!hasOnlyFields(report, NOTE_FIELDS)) return refuse("Unrecognised field in note.");

  if (typeof report.text !== "string") return refuse("Note text is required.");
  const text = report.text.trim();
  if (text === "") return refuse("Note text is required.");
  if (text.length > MAX_TEXT_LENGTH) return refuse("That note is too long.");

  if (report.context === undefined || report.context === null) {
    return { ok: true, note: { text, context: null } };
  }

  const context = contextFromReport(report.context);
  if (context === null) return refuse("That is not a session context.");
  return { ok: true, note: { text, context } };
}

function contextFromReport(value: unknown): FeedbackContext | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;

  if (!hasOnlyFields(raw, CONTEXT_FIELDS)) return null;

  const seedWord = line(raw.seedWord);
  const rank = line(raw.rank);
  const url = line(raw.url);
  const timestamp = line(raw.timestamp);
  const score = count(raw.score);
  const foundAnswers = count(raw.foundAnswers);
  const totalAnswers = count(raw.totalAnswers);
  const foundBonus = count(raw.foundBonus);

  if (
    seedWord === null ||
    rank === null ||
    url === null ||
    timestamp === null ||
    score === null ||
    foundAnswers === null ||
    totalAnswers === null ||
    foundBonus === null
  ) {
    return null;
  }

  return { seedWord, score, rank, foundAnswers, totalAnswers, foundBonus, url, timestamp };
}

function line(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length > MAX_CONTEXT_STRING_LENGTH) return null;
  if (!SINGLE_LINE.test(value)) return null;
  return value;
}

function count(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 0 || value > MAX_COUNT) return null;
  return value;
}
