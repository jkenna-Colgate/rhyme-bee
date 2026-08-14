/**
 * The Candidate Queue's second section, as the browser selects it: the deferred
 * readings out of the one readout, and the proposal an approve card is drawn
 * over (#181).
 *
 * ## Why it computes nothing
 *
 * `dayCandidates.ts`'s reason, and the same shape: every state on the screen was
 * derived in Node against the pinned sources (`scripts/editorDeferred.ts`), and
 * the browser has neither the readings nor the Normalisation to second-guess it
 * with. So this selects, and the one thing it *builds* is built by a function
 * from `correction.ts` rather than here.
 *
 * ## Why the proposal is built here and not in the view
 *
 * Because it is the whole of the reuse, and reuse a test can hold to account is
 * reuse that survives. `honestReading` (`./correction.ts`) is #180's own
 * function: it turns a reading the add path proposed and verification refused
 * into the `CorrectionProposal` that `CorrectionPanel` approves, and #180 built
 * it over deferred outcomes arriving live from an add. This hands it the *file's*
 * copy of the same value. Nothing else about the approval differs — same card,
 * same `Corrector`, same `POST /api/editor/correction`, same write — which is
 * what #181 means by refusing a second approval path.
 */

import type { CandidateQueueReadout } from "../../../scripts/editorCandidates.ts";
import {
  isDeferralOutstanding,
  NO_DEFERRALS,
  type DeferredSection,
  type ReadDeferral,
} from "../../../scripts/editorDeferred.ts";
import { honestReading, type CorrectionProposal } from "./correction.ts";

/**
 * The deferred readings on a readout.
 *
 * **Total, and never null**, for `candidatesForDay`'s reason: a queue that has
 * not loaded, one that failed to load and one whose deferred file is empty are
 * three different facts and the same thing to render — an empty section, never
 * an error — and the caller tells them apart from the fetch's own state.
 */
export function deferredReadings(queue: CandidateQueueReadout | null): DeferredSection {
  return queue?.deferred ?? NO_DEFERRALS;
}

/** Re-exported so a view asks one module about one section. */
export { isDeferralOutstanding };

/**
 * The proposal a deferral's approve card is drawn over, or `null` when there is
 * nothing to approve.
 *
 * Only the `proposed` state has a reading to judge: an unreachable agent
 * proposed nothing, and an answered deferral has already been written. The
 * target is the deferral's own Rhyme Key — the key the add was aimed at — so
 * `reaches` comes back false for a reading that failed verification, which is
 * what "failed verification" means and is recomputed rather than assumed.
 */
export function proposalFor(deferral: ReadDeferral): CorrectionProposal | null {
  if (deferral.state !== "proposed") return null;
  return honestReading(deferral.word, deferral.rhymeKey, deferral.proposed);
}
