# General American is the only accent the game adjudicates in

Rhyme is not a property of a word pair; it is a property of a word pair **in an accent**. The game therefore commits to General American, sourced from CMUdict, and states so to the player. Verdicts that are wrong in other accents are an accepted cost.

## Why this is not neutral

- `ate` is /eɪt/ in General American and commonly /ɛt/ in standard British English. For millions of speakers `ate` rhymes with `bet`, not `late`.
- Non-rhotic accents (England, Australia, NZ, parts of the US) make `idea` rhyme with `beer` and `father` with `Java`.
- The cot–caught merger, present across most of the western US and absent in NYC and the UK, decides whether `stock` rhymes with `stalk`.

There is no accent-neutral position available. "Correct" is a dialect chosen and imposed.

## Which General American

**Amended by [ADR-0010](./0010-normalisation-erases-inaudible-contrasts.md).** "General American" alone does not settle the cot–caught question above, and CMUdict does not settle it either — it records both vowels. The accent is therefore specified as **merged** General American: `AO` ≡ `AA` outside pre-rhotic position. `stock` rhymes with `stalk`, and `ball` with `doll`; before `R` the contrast survives, so `for` does not rhyme with `far`.

This is a specification of *which* General American, not an override of the decision to have one. A player who does not have the merger will meet verdicts they disagree with — exactly the declared cost this ADR already accepts, now named rather than left to whichever vowel CMUdict happened to record.

## Considered Options

**Accept anything that rhymes in any major accent.** Rejected. It sounds generous but means `bet` is a valid answer for `ate`, which to an American player is not generosity — it is evidence the game is broken. It also destroys any fixed answer count, and the shared, stable denominator is most of what makes a daily word game work.

**Per-locale puzzle sets.** Rejected for v1 on cost. It also requires pronunciation data for other accents; CMUdict is the only free, high-quality, stress-marked dictionary available, which makes General American the path of least resistance as well as the largest audience.

## Consequences

- The Seed Word is **spoken aloud** before play begins. This is load-bearing, not a convenience: it establishes the canonical pronunciation up front instead of letting the player discover it through an unjust-feeling rejection, and it tells a non-American player immediately which accent they are playing in.
- Accent-unstable words make poor Seed Words and should be avoided when curating. `ate` is retained as the tutorial seed regardless, on the strength of playtesting.
