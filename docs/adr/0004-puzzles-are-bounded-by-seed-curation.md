# Puzzles are bounded by curating Seed Words, not by truncating answer sets

Answer set sizes vary wildly by Rhyme Key — `ate` has hundreds of valid rhymes, `month` has none. Puzzle difficulty is controlled by **selecting Seed Words whose answer count falls in a playable band**, rather than by capping each puzzle at the top N answers.

## Why not truncate

Truncating means rejecting words that genuinely rhyme and that the player genuinely knows. That breaks the game's core promise — *say them out loud and they rhyme* — in the most infuriating way possible, since the player is right and the game says no. Seed curation achieves the same bound with no false rejections, and it is a one-time offline job over the dictionary rather than per-puzzle labour.

## Consequences

- **The content library is finite and possibly small.** The puzzle universe is the number of Rhyme Keys with a playable number of known words attached — not the number of words. Seeding with `late` instead of `great` yields the same key, the same answers, the same puzzle. Rhyme families are lumpy: a few are enormous, most of the tail is empty, and the playable middle is narrow. **This number has not been computed and it materially changes what should be built** — ~80 families is a seasonal run, ~800 is a daily for years.
- The mitigation if the count is low is to widen the size band rather than to truncate. This is nearly free, because ranks are percentage-based and adapt to puzzle size without retuning.
- A repeat policy will eventually be needed. Not before launch.
- Computing the distribution is the **first task when building**: derive every word's Rhyme Key, filter by prevalence, drop proper nouns, group by key, histogram. It produces the candidate seed list as a by-product, which is needed regardless.
- The tutorial seed `ate` is exempt from the band. It is unscored, and its job is to teach the sound rule.
