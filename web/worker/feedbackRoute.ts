/**
 * The general-note endpoint: a playtester jotted something down, and this files
 * it as an issue on the tracker, so a note written in the deployed game enters
 * the same triage flow the maintainer already works through.
 *
 * It is transport and nothing else. It judges nothing — the Puzzle was played
 * and adjudicated in the browser before any of this was called, and a note is a
 * report about that, never a request for a verdict (ADR-0013). What a valid note
 * is, and how one becomes an issue title and body, lives in the pure
 * `../src/feedback/feedbackIssue.ts`, which the dev-only Vite plugin shares.
 *
 * **The title is the derived one.** In development a note is titled by the
 * `claude` CLI on the maintainer's subscription; a Worker has no CLI and no API
 * key, and putting one there would be a second credential on the network for a
 * nicety. So the deployed path takes the fallback `resolveTitle` already has, by
 * supplying no generated title at all.
 *
 * There is no rate limiting, deliberately (#114, Step 9). The URL is unlisted
 * and the worst case is junk issues in a private tracker; a cap here would be
 * reversing a recorded decision. Payload validation is a separate concern and is
 * applied in full.
 */

import {
  buildIssueBody,
  noteFromReport,
  resolveTitle,
  MAX_NOTE_BYTES,
} from "../src/feedback/feedbackIssue.ts";
import { json, readReport } from "./http.ts";
import type { Env } from "./env.ts";

/** The label that puts a filed note in front of the maintainer's triage. */
const LABEL = "feedback";

const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
/** GitHub rejects an API request that does not identify its caller. */
const USER_AGENT = "rhyme-bee";

/** No generated title on this path — see the note at the top of the file. */
const noGeneratedTitle = async (): Promise<null> => null;

/**
 * Why the tracker said no, in terms that name the cause. An expired token is a
 * live possibility — #114 puts a deliberate expiry on it — and a note silently
 * failing to file for months is exactly the outcome this endpoint exists to
 * avoid, so the status is reported. GitHub's own response body is not, because
 * it is a raw error from a system that knows the repository and the credential.
 */
function refusalMessage(status: number): string {
  switch (status) {
    case 401:
      return "The tracker rejected the reporting credential (401): it is empty, invalid or expired.";
    case 403:
      return "The tracker refused the reporting credential (403): it is not allowed to file issues here.";
    case 404:
      return "The tracker was not found (404): the reporting credential may no longer reach that repository.";
    case 422:
      return "The tracker refused this note as invalid (422).";
    default:
      return `The tracker refused this note (${status}).`;
  }
}

export async function handleFeedback(request: Request, env: Env): Promise<Response> {
  const outcome = await readReport(request, {
    maxBytes: MAX_NOTE_BYTES,
    method: "Send a note with POST.",
    tooLarge: "That note is too large.",
    notJson: "That note is not JSON.",
    // A refusal returns no note at all, so there is nothing partial to file
    // and the tracker is never called.
    validate: noteFromReport,
  });
  if (!outcome.ok) return outcome.response;
  const { note } = outcome.report;

  const token = env.GITHUB_ISSUE_TOKEN?.trim();
  if (!token) {
    // Distinguishable on purpose: an empty secret uploads silently (#114,
    // Step 7), and "not configured" is a different problem from "refused".
    return json(503, { error: "Reporting is not configured: the tracker credential is unset." });
  }

  const title = await resolveTitle(note.text, noGeneratedTitle);

  let response: Response;
  try {
    response = await fetch(`${GITHUB_API}/repos/${env.ISSUE_REPO}/issues`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
      body: JSON.stringify({
        title,
        body: buildIssueBody(note.text, note.context),
        labels: [LABEL],
      }),
    });
  } catch {
    // Whatever was thrown stays here. A fetch error can carry the request that
    // failed, and that request carries the token in a header.
    return json(502, { error: "Could not reach the tracker." });
  }

  if (!response.ok) return json(502, { error: refusalMessage(response.status) });

  let issue: { number?: unknown; html_url?: unknown };
  try {
    issue = (await response.json()) as { number?: unknown; html_url?: unknown };
  } catch {
    return json(502, { error: "The tracker's reply could not be read." });
  }
  if (typeof issue.number !== "number" || typeof issue.html_url !== "string") {
    return json(502, { error: "The tracker's reply could not be read." });
  }

  // The shape the button already expects: an issue number and somewhere to go
  // and look at it.
  return json(201, { number: issue.number, url: issue.html_url });
}
