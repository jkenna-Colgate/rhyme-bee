/**
 * Whether this browser has ever opened the game before — the one bit the
 * Tutorial hangs off (#116). The Tutorial is the unscored first-run Puzzle, so
 * it runs once and is never shown again: not on a reload, and not tomorrow.
 *
 * Thin, untested I/O, on the same principle as the browser index loader: there
 * is no logic here to cover, only a `localStorage` read and write. Both are
 * wrapped, because in a locked-down Safari `localStorage` *throws* on access
 * rather than returning null. The failure mode that leaves is a player who is
 * shown the Tutorial on every visit, which is survivable; a boot that throws is
 * not.
 */

const VISITED_KEY = "rhyme-bee:visited";

/** True until `markVisited` has recorded a visit in this browser. */
export function isFirstVisit(): boolean {
  try {
    return window.localStorage.getItem(VISITED_KEY) === null;
  } catch {
    return true;
  }
}

/** Remember this browser, so the Tutorial is not offered a second time. */
export function markVisited(): void {
  try {
    window.localStorage.setItem(VISITED_KEY, "1");
  } catch {
    // No storage available: the Tutorial reappears next visit. Not worth a crash.
  }
}
