# Rhyme is defined as the last stressed syllable onward

Two words rhyme when the sounds from their **last stressed vowel** to the end of the word match, where the stress may be primary *or* secondary. This is looser than a poet's perfect rhyme, which requires primary stress. Spelling is irrelevant throughout: `eight` rhymes with `ate`, `chocolate` does not.

## Considered Options

**Primary stress only (strict perfect rhyme).** Rejected after playtesting. Given the seed `ate`, this rule rejects `adjudicate` (ə-JU-di-cate), `correlate` (COR-re-late) and `impregnate` (im-PREG-nate) — three of the five words the designer found most satisfying in a manual play session. Only `collate` survives. The rule was technically defensible and destroyed the game's best moments.

**Final syllable, stress ignored.** Rejected. Admits `chocolate`, `private`, `climate`, `senate`, `accurate` — words that share the spelling `-ate` but end in an unstressed schwa. These fail the game's own player-facing test ("say both words aloud and they rhyme"), which would make the game feel like spelling-matching wearing a phonetics costume.

## Consequences

- Homophones count. `ate`/`eight` is valid. Rejecting identical rhymes is a poetry-workshop rule that reads as arbitrary to a player who typed a real word that sounds the same.
- A Submission is accepted if **any** of its pronunciations rhymes. `read` is a valid rhyme for `bed`, `tear` for `beer`. This is deliberate — it is the sound-over-spelling insight the game exists to reward — and it means variant pronunciations must be indexed, not collapsed.
- The Seed Word, by contrast, is pinned to exactly one pronunciation. A `bass` puzzle is otherwise incoherent.
- CMUdict marks vowel stress explicitly (`0` unstressed, `1` primary, `2` secondary), so this rule is implementable as "scan backwards to the last vowel marked 1 or 2" with no interpretation layer.
- Answer sets are much larger than under strict rhyme. English has hundreds of `-ate` verbs. See ADR-0004.

## Amendment (2026-07-29)

**The clause "with no interpretation layer" in the final Consequence above is struck**, by [ADR-0010](./0010-normalisation-erases-inaudible-contrasts.md).

CMUdict encodes contrasts at a finer resolution than the ear. Read literally, it promoted sub-perceptual distinctions to confident rejections — `talked` was refused for `docked` over `AO` versus `AA`, a difference the maintainer could not hear across repeated replays. There *is* an interpretation layer: pronunciations are normalised at build time, before this rule runs.

**The rule itself is unchanged, and nothing else in this ADR is affected.** Rhyme is still the sounds from the last stressed vowel to the end of the word; `chocolate` still does not rhyme with `ate`, and a committed guardrail table now enforces that it never will. Only the reading the rule is applied to has changed.

## Amendment (2026-10-03)

**The rule is unchanged again, and a second verdict now sits beside it**, by
[ADR-0020](./0020-a-weak-rhyme-is-accepted-and-not-scored.md).

A Submission that matches the Seed Word only on an unstressed final syllable
(`magic` for `trick`) is still not a Rhyme. It is no longer rejected: it is
accepted as a Weak Rhyme and scores nothing. "Final syllable, stress ignored"
stays rejected as the definition of a Rhyme.

One detail of that rejected option is corrected. It says the option admits
`chocolate`, `private` and `climate` for `ate`. Matched by sound it does not:
those words end in `AH0 T`, so what it admits is `chocolate` for `hut`. The
option was right to be rejected, and the example was a spelling match where the
option is a sound match. `chocolate` is not a Rhyme for `ate` and not a Weak
Rhyme for it either.
