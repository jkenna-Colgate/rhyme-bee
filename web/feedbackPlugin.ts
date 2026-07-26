/**
 * The dev-only feedback endpoint. A Vite plugin that, during `npm run dev` only
 * (`apply: "serve"` and `configureServer` never run in a production build),
 * serves `POST /api/feedback`: it turns a jotted note into a GitHub issue on
 * this repo by shelling out to the `gh` CLI (already authenticated) and titles
 * it with the `claude` CLI in headless print mode (the maintainer's Pro
 * subscription — no API key anywhere).
 *
 * All dynamic content travels through stdin — the issue as JSON to
 * `gh api --input -`, the prompt to `claude` — so no user text is ever placed
 * on a command line. The only args are static tokens, which keeps `shell: true`
 * (needed to resolve `gh`/`claude` on Windows) safe. The pure title/body
 * decisions live in `src/feedback/feedbackIssue.ts`.
 */

import { spawn } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import {
  buildIssueBody,
  cleanGeneratedTitle,
  resolveTitle,
  type FeedbackContext,
} from "./src/feedback/feedbackIssue.ts";

const LABEL = "feedback";

interface FeedbackRequest {
  text: string;
  context: FeedbackContext | null;
}

/** Spawn a CLI, feeding `input` on stdin and resolving with its stdout. Rejects
 *  on a non-zero exit, surfacing stderr so the caller can decide what to do. */
function run(command: string, args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
    child.stdin.end(input);
  });
}

/** Ask Haiku for a concise title, via the Claude Code CLI reading the prompt on
 *  stdin. Normalisation (and any empty-result fallback) is the pure module's
 *  job, so this stays a thin shell over the CLI. */
async function generateTitle(text: string): Promise<string> {
  const prompt = [
    "Write a concise GitHub issue title (max ~70 characters) summarising this",
    "play-testing feedback on a word game. No surrounding quotes, no trailing",
    "punctuation. Respond with ONLY the title.",
    "",
    "Feedback:",
    text,
  ].join("\n");
  return cleanGeneratedTitle(await run("claude", ["-p", "--model", "haiku"], prompt));
}

/** Ensure the `feedback` label exists so issue creation can apply it. Best
 *  effort: a 422 when it already exists (or being offline) is swallowed. */
async function ensureLabel(): Promise<void> {
  const body = JSON.stringify({
    name: LABEL,
    color: "BFD4F2",
    description: "Play-testing feedback jotted from the dev feedback button",
  });
  try {
    await run("gh", ["api", "repos/{owner}/{repo}/labels", "--method", "POST", "--input", "-"], body);
  } catch {
    // Already exists, or gh is unavailable — creation of the issue will report
    // any real problem when it runs.
  }
}

/** Create the issue via the GitHub API, everything on stdin as JSON. */
async function createIssue(title: string, body: string): Promise<{ number: number; url: string }> {
  const payload = JSON.stringify({ title, body, labels: [LABEL] });
  const out = await run(
    "gh",
    ["api", "repos/{owner}/{repo}/issues", "--method", "POST", "--input", "-"],
    payload,
  );
  const issue = JSON.parse(out) as { number: number; html_url: string };
  return { number: issue.number, url: issue.html_url };
}

function readJson(req: IncomingMessage): Promise<FeedbackRequest> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw) as FeedbackRequest);
      } catch {
        reject(new Error("Malformed request body."));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

export function feedbackPlugin(): Plugin {
  return {
    name: "rhyme-bee-feedback",
    apply: "serve",
    configureServer(server) {
      // Kick off label creation once at startup, but keep the promise so the
      // first submit can await it — otherwise a submit could race ahead of the
      // label existing and `createIssue`'s `labels: ["feedback"]` would fail.
      const labelReady = ensureLabel();
      server.middlewares.use("/api/feedback", (req, res, next) => {
        if (req.method !== "POST") return next();
        void (async () => {
          try {
            const { text, context } = await readJson(req);
            if (typeof text !== "string" || text.trim() === "") {
              return sendJson(res, 400, { error: "Feedback text is required." });
            }
            const title = await resolveTitle(text, () => generateTitle(text));
            await labelReady;
            const issue = await createIssue(title, buildIssueBody(text, context ?? null));
            sendJson(res, 201, issue);
          } catch (error) {
            sendJson(res, 500, {
              error: error instanceof Error ? error.message : "Failed to file feedback.",
            });
          }
        })();
      });
    },
  };
}
