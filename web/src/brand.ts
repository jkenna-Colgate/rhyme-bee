/**
 * What the game calls itself to a player — one constant, so the wordmark cannot
 * differ between the heading above the board and anything generated from it
 * (#199).
 *
 * It is deliberately *not* the `rhyme-bee` slug, which names the package, the
 * repository, the R2 bucket, the deployed Worker and both `localStorage` keys.
 * The slug is an identifier and moving it would discard live players'
 * in-progress Sessions in exchange for a string no player ever sees; this is a
 * correction to the wordmark alone. The two do not track each other, and the
 * note in `AGENTS.md` says so, so nobody later reconciles them.
 *
 * `index.html` and `editor.html` cannot import this — they are static documents
 * — so they repeat the string with a comment pointing here, and
 * `__tests__/brand.test.ts` reads their titles back to keep the repetition
 * honest.
 */

/**
 * The wordmark. Gerund plus `Bee`, like quilting bee, husking bee and spelling
 * bee: the `-bee` compound names an activity and the gathering around it, and
 * the bare noun adjunct "Rhyme Bee" sat off that pattern — good English, but
 * reading as a clipped modern coinage rather than a member of the tradition.
 */
export const GAME_NAME = "Rhyming Bee";
