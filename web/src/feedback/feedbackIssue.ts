/**
 * The pure core of the dev-only feedback button: how a jotted note becomes a
 * GitHub issue's title and body. No I/O lives here — spawning `gh`/`claude` and
 * serving the endpoint is the impure shell around these functions (see
 * `../../feedbackPlugin.ts`), so the interesting decisions stay testable.
 */

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
