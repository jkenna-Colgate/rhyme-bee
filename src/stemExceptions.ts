/**
 * Stem exceptions: a word and the stem its knownness is read from, for the few
 * words whose best-known candidate stem is the wrong one (#313).
 *
 * A word with no prevalence row of its own reads as its best-known candidate
 * stem (`knownStem` in `lemmatise.ts`). That is right almost everywhere, and
 * wrong where a short, common word happens to be a spelling of the stem with a
 * letter dropped: `hissed` would read as `his`, `severed` as `severe`. Each line
 * here was read by a person off the list of words the rule moves, so the list
 * is bounded by that measurement and is never generated.
 *
 * An exception, not a Tier verdict, because a verdict sets a Tier rather than a
 * knownness and would go stale when the Answer line moves; and the Tier override
 * file is written by the Editor's Pass, never by hand.
 */
export const STEM_EXCEPTIONS: ReadonlyMap<string, string> = new Map([
  ["butts", "butt"], // not `but`
  ["hissed", "hiss"], // not `his`
  ["hisses", "hiss"], // not `his`
  ["putts", "putt"], // not `put`
  ["putted", "putt"], // not `put`
  ["severed", "sever"], // not `severe`
  ["severing", "sever"], // not `severe`
  ["suited", "suit"], // not `suite`
  ["lolling", "loll"], // not `lol`
  ["mattes", "matte"], // not `mat`
  ["steppes", "steppe"], // not `step`
  ["canvassed", "canvass"], // not `canvas`
  // Read off the moved-word list after the rule landed, beyond the twelve
  // measured before it.
  ["canvasses", "canvass"], // not `canvas`, as `canvassed`
  ["canvassing", "canvass"], // not `canvas`, as `canvassed`
  ["enveloped", "envelop"], // the verb, not `envelope`
  ["enveloping", "envelop"], // the verb, not `envelope`
  ["psyched", "psych"], // `psyched up`, not `psyche`
  ["finns", "finn"], // the people, not `fin`
]);
