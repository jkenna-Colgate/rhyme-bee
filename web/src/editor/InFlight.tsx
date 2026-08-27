/**
 * What a request that writes shows while it runs, for both gestures that make
 * one: the typed queue's Submit and the pasted pile's accept (#190).
 *
 * A Submit is one request that can legitimately take minutes — a word no
 * compound split reaches is handed to an agent that is given up to a minute, and
 * those waits are serial — and a pasted pile of two hundred can run for hours. A
 * disabled button on its own is indistinguishable from a hung tab at exactly
 * that moment, so this says three things instead: what is happening, how long it
 * has been happening, and the worst case it is running against. The seconds
 * tick, which is what makes "slow" legible as "running".
 *
 * The bound is stated as a **maximum and not an estimate**, because it is one:
 * a word a compound split reaches is written in milliseconds and never touches
 * an agent. Quoting the typical case would be the number that makes the long
 * batch feel broken.
 *
 * ## Why one shell and two sentences
 *
 * The arithmetic is the same for both — the same clock, the same
 * `WORST_CASE_MS_PER_WORD` per word, the same pluralisation — and two copies of
 * it are two things to correct when the agent's timeout moves. What is genuinely
 * different is the prose at each end, and it is different on purpose: a pasted
 * pile is words the editor never typed and cannot lose by waiting, so it has to
 * say that walking away is safe, which is not something a fifty-word Submit
 * needs to promise. So the shell owns the clock and the bound, and each caller
 * brings its own two clauses.
 */

import type { ReactNode } from "react";
import { WORST_CASE_MS_PER_WORD } from "./add.ts";

export function InFlight({
  count,
  elapsedMs,
  doing,
  leaving,
}: {
  /** How many words this batch carries — the count the bound is computed from. */
  count: number;
  elapsedMs: number;
  /** What is happening, as a clause: it follows the clock and precedes the bound. */
  doing: ReactNode;
  /** What is safe to do while it runs, as a sentence of its own. */
  leaving: ReactNode;
}) {
  const worstCaseMinutes = Math.ceil((count * WORST_CASE_MS_PER_WORD) / 60_000);
  return (
    <p className="editor-add-inflight" role="status">
      <strong>{Math.floor(elapsedMs / 1000)}s</strong> — {doing}. A word no compound split
      reaches waits on an agent for up to a minute, so this can run to {worstCaseMinutes}{" "}
      {worstCaseMinutes === 1 ? "minute" : "minutes"}. {leaving}
    </p>
  );
}
