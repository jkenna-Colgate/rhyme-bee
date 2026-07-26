/**
 * Speak the Seed Word aloud via the browser's Web Speech API (`SpeechSynthesis`).
 * The audio is a convenience only: generic TTS cannot be trusted to honour the
 * pinned Rhyme Key (a homograph, or a plain mispronunciation), so the on-screen
 * `seedRespelling` stays the source of truth. No pre-rendered or pinned per-Seed
 * audio — only live Web Speech API TTS (issue #36).
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
