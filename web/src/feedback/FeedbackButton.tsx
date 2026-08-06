/**
 * The feedback affordance: a fixed bottom-right button that opens a non-modal,
 * compact popover with a single textarea. Submitting POSTs the note, plus the
 * live session context read at submit time, to the feedback endpoint, which
 * files it as an issue on the tracker — a dev-server Vite plugin during
 * `npm run dev`, a route on the Worker once deployed (#118).
 *
 * It ships in production. A playtester's only channel back is what they can say
 * from inside the game, and reporting is out of band: if the endpoint is down or
 * unreachable the failure is shown and the Puzzle carries on, because judging
 * happens in the browser (ADR-0013). A failed submit keeps the typed text, so a
 * hiccup never eats what someone wrote.
 *
 * The popover has no backdrop and no focus trap: the game underneath stays fully
 * interactive, so you can keep submitting words to reproduce a pattern and jot
 * them all into one note. It holds no game logic and is left untested, like the
 * rest of the shell; the interesting decisions live in `feedbackIssue.ts`.
 */

import { useState } from "react";
import type { Session } from "../../../src/session.ts";
import { FEEDBACK_PATH } from "../endpoints.ts";
import type { FeedbackContext } from "./feedbackIssue.ts";

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "filed"; number: number; url: string }
  | { kind: "error"; message: string };

function snapshot(session: Session): FeedbackContext {
  const progress = session.progress();
  return {
    seedWord: session.seed.word,
    score: session.score(),
    rank: session.rank().label,
    foundAnswers: progress.found,
    totalAnswers: progress.totalAnswers,
    foundBonus: progress.foundBonus,
    url: window.location.href,
    timestamp: new Date().toISOString(),
  };
}

export function FeedbackButton({ session }: { session: Session }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (text.trim() === "" || status.kind === "sending") return;
    setStatus({ kind: "sending" });
    try {
      const res = await fetch(FEEDBACK_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, context: snapshot(session) }),
      });
      const payload = (await res.json()) as { number?: number; url?: string; error?: string };
      if (!res.ok || payload.number === undefined || payload.url === undefined) {
        // Keep the typed text — a hiccup must never eat what you wrote.
        setStatus({ kind: "error", message: payload.error ?? `Request failed (${res.status}).` });
        return;
      }
      setStatus({ kind: "filed", number: payload.number, url: payload.url });
      setText("");
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Network error." });
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="feedback-fab"
        onClick={() => setOpen(true)}
        aria-label="Open feedback"
        title="Send feedback"
      >
        🐝 Feedback
      </button>
    );
  }

  return (
    <section className="feedback-panel" aria-label="Send feedback">
      <div className="feedback-panel__head">
        <span className="feedback-panel__title">Feedback</span>
        <button
          type="button"
          className="feedback-panel__close"
          onClick={() => setOpen(false)}
          aria-label="Close feedback"
        >
          ×
        </button>
      </div>
      <form onSubmit={submit}>
        <textarea
          className="feedback-panel__text"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (status.kind !== "sending") setStatus({ kind: "idle" });
          }}
          placeholder="What's wrong (or right)? Jot it down…"
          rows={4}
          autoFocus
        />
        <div className="feedback-panel__foot">
          <button
            type="submit"
            className="feedback-panel__submit"
            disabled={status.kind === "sending" || text.trim() === ""}
          >
            {status.kind === "sending" ? "Filing…" : "Submit"}
          </button>
          {status.kind === "filed" && (
            <a
              className="feedback-panel__filed"
              href={status.url}
              target="_blank"
              rel="noreferrer"
            >
              ✓ Filed #{status.number}
            </a>
          )}
          {status.kind === "error" && (
            <span className="feedback-panel__error" role="alert">
              {status.message}
            </span>
          )}
        </div>
      </form>
    </section>
  );
}
