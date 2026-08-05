/**
 * Speak the Seed Word aloud via the browser's Web Speech API (`SpeechSynthesis`).
 * The audio is a convenience only: generic TTS cannot be trusted to honour the
 * pinned Rhyme Key (a homograph, or a plain mispronunciation), so the on-screen
 * `seedRespelling` stays the source of truth. No pre-rendered or pinned per-Seed
 * audio — only live Web Speech API TTS (issue #36).
 *
 * iOS Safari refuses to synthesise anything unless the *first* `speak` of a
 * visit is called from inside a user gesture, and it is that first call which
 * unlocks synthesis for the rest of the visit. So the Puzzle is gated behind a
 * start tap whose handler calls `speak` on the Seed Word synchronously (#116).
 * Every later call — the replay button, the auto-speak on a free-play draw —
 * rides on that unlock. Nothing here may be moved into an effect that runs
 * before the tap, or the Seed goes unspoken on a phone.
 */

/** True when the browser exposes the Web Speech API, so the shell can hide a dead button. */
export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Speak `text` now, cancelling anything mid-utterance so replay is immediate. */
export function speak(text: string): void {
  if (!speechSupported()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  // General American is the accent the game adjudicates in (ADR-0002).
  utterance.lang = "en-US";
  synth.speak(utterance);
}
