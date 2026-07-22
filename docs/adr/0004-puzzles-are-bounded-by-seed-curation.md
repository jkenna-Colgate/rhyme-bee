# Puzzles are bounded by curating Seed Words, not by truncating answer sets

Answer set sizes vary wildly by Rhyme Key — `ate` has hundreds of valid rhymes, `month` has none. Puzzle difficulty is controlled by **selecting Seed Words whose answer count falls in a playable band**, rather than by capping each puzzle at the top N answers.

## Why not truncate

Truncating means rejecting words that genuinely rhyme and that the player genuinely knows. That breaks the game's core promise — *say them out loud and they rhyme* — in the most infuriating way possible, since the player is right and the game says no. Seed curation achieves the same bound with no false rejections, and it is a one-time offline job over the dictionary rather than per-puzzle labour.

## Consequences

- **The content library is finite and possibly small.** The puzzle universe is the number of Rhyme Keys with a playable number of known words attached — not the number of words. Seeding with `late` instead of `great` yields the same key, the same answers, the same puzzle. Rhyme families are lumpy: a few are enormous, most of the tail is empty, and the playable middle is narrow. **This number materially changes what should be built** — ~80 families is a seasonal run, ~800 is a daily for years. It has now been computed; see [Resolution](#resolution-2026-07-22).
- The mitigation if the count is low is to widen the size band rather than to truncate. This is nearly free, because ranks are percentage-based and adapt to puzzle size without retuning.
- A repeat policy will eventually be needed. Not before launch.
- Computing the distribution is the **first task when building**: derive every word's Rhyme Key, filter by prevalence, drop proper nouns, group by key, histogram. It produces the candidate seed list as a by-product, which is needed regardless.
- The tutorial seed `ate` is exempt from the band. It is unscored, and its job is to teach the sound rule.

## Resolution (2026-07-22)

The distribution has been computed by running the production curation path
(`npm run histogram`) over CMUdict, the word-prevalence norms, and the common-word
list. Counts are at the tuned knownness threshold of 0.0 (see ADR-0003's
Resolution), since the Answer/Bonus split is what sizes a family. English contains
**17,750 distinct Rhyme Keys**, and **325** of them fall in the default playable
band of 20–120 Answers.

```
answers   families
      0 | ##########################################  12287
      1 | ########                                     2294
    2–4 | ######                                       1710
    5–9 | ##                                            696
  10–19 | #                                             416
  20–49 | #                                             245  ┐ band [20, 120]
 50–120 |                                                80  ┘ → 325 candidates
   121+ |                                                22
```

The shape is exactly as predicted: a huge empty tail (12,287 keys have no
Answer-tier rhyme at all — obscure-only or singleton families), a steep drop, and
a narrow playable middle. The full per-count histogram is regenerable at
`dist-data/histogram.txt`.

**Decision: ship v1 at the default band [20, 120].** 325 puzzles is not the
~80-family seasonal run the low case feared; at one per day it is roughly eleven
months of never-repeat play, comfortably enough to launch and validate the game.
It is also not yet the ~800 that would make repeats a non-issue for years, so the
size of the library stays a tracked concern rather than a solved one.

**Pre-approved first lever if the library needs to grow: widen the floor to
[10, 120].** That admits the 416 families with 10–19 Answers, taking the candidate
pool to ~741 — most of the way to the "daily for years" case — without touching
the ceiling or truncating anything. Per the reasoning above this is nearly free:
ranks are percentage-based and adapt to smaller Answer sets without retuning. The
band lives in configuration (`BAND_MIN`/`BAND_MAX`), so widening is a config change
and a rebuild, not a code change.

We are **not** widening now: 325 is enough for launch, and a smaller minimum band
means thinner puzzles, so it is better spent as headroom held in reserve than as
launch content.
