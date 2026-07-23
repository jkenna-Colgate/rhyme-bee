# Difficulty is the share of a Puzzle's Score locked in rare words, and the week ramps up it

Within the playable size band, a Puzzle's **Difficulty** is the fraction of its
maximum achievable Score that lives in **rare** Answers:

```
maxScore   = Σ score(answer)                       // the Rank denominator
rareMass   = Σ score(answer) where answer is rare  // rare ⇔ knownness < rareKnownnessCutoff
difficulty = rareMass / maxScore                   // 0…1, higher = harder
```

"Rare" is the **same** line the scoring bonus already uses (`rareKnownnessCutoff`,
default `0.7` — see [ADR-0006](./0006-scoring-is-length-dominant-with-a-flat-rare-bonus.md)),
not a second notion. The shipped week is a **monotonic ramp**: Monday is drawn
from the easiest Difficulty, Sunday from the hardest, so a player learns to expect
how hard today will be before they start.

This **refines [ADR-0004](./0004-puzzles-are-bounded-by-seed-curation.md)**, which
said difficulty is "controlled by selecting Seed Words whose answer count falls in
a playable band." That conflated two things. Band selection controls whether a
Puzzle is *playable* (not 3 answers, not 500) — a **size** decision. It does not
control whether the Puzzle is *hard*. Difficulty is a second, orthogonal axis
*within* the band, and this ADR defines it.

## Why not answer count

The obvious lever is "more answers = harder." It is wrong here, and the reason is
our own design. Rank is `Score ÷ maxScore`, a percentage, built (ADR-0004,
ADR-0006) precisely so a 25-Answer and a 110-Answer Puzzle both top out at 100% and
the same tier ladder applies to both. That self-normalisation means a bigger Puzzle
is **not harder to reach Genius in** — it is a *longer session*. Folding answer
count into Difficulty would fight the very property that makes Rank comparable day
to day. So count is a **session-length** dial, not a Difficulty one. It may
*co-vary* with Difficulty in the shipped schedule (a hard Saturday can also be
meatier), but it never *defines* it.

## Why score-mass in rare words

What actually makes a Rank hard to reach is not how *many* answers exist but
**where the Score-mass sits**. If reaching Genius forces you to know low-knownness
words, the Puzzle is hard; if a player who only knows common words can coast to the
top ladder, it is easy. `rareMass / maxScore` measures exactly that, and it has a
property that keeps the whole model legible:

> **A common-only player's Rank ceiling is `1 − difficulty`.**

Because `rareMass` is the Score a player who knows no rare words can never earn, the
best Rank they can reach is `(maxScore − rareMass) / maxScore = 1 − difficulty`.
"Saturday is hard" becomes a sentence a player can hold: *knowing only common words
tops you out below Genius; you have to dig for rare words to finish.* Difficulty is
expressed entirely in Score — the game's own currency — not a proxy bolted on the
side.

For that identity to be **exact**, Difficulty must use the *same* `score(answer)`
the game scores with. So the scoring primitive (`scoreEntry`, `ScoringConfig`,
`DEFAULT_SCORING_CONFIG`) is extracted from the session layer into a shared
`scoring.ts` that both the session (scoring a game in progress) and curation
(scoring a candidate's Difficulty) import. A consequence follows: **Difficulty is
downstream of `ScoringConfig`.** Retune `rareBonus` or `rareKnownnessCutoff` and the
Difficulty ranking — hence the weekly schedule — shifts. That is correct, because
Difficulty is defined in Score's own terms; it just means the schedule is rebuilt
when scoring is retuned, not pinned independently of it.

## Why binary rare, not a knownness gradient

Difficulty reuses the flat `< 0.7` rare line rather than weighting each Answer by
*how* rare it is. This is the same call ADR-0006 already made for scoring, for the
same reason: a continuous gradient is opaque, and it would give the system a second,
divergent notion of "rare." One line, one meaning — *the share of a Puzzle's points
that live in words most people don't know* — is a Difficulty you can explain.

## Why a monotonic ramp

The week is a strictly increasing ramp, Monday easiest → Sunday hardest, mapped onto
seven Difficulty buckets with no special-case day. It is one rule a player can state
out loud — *"each day is a little harder than the last, and it resets Monday"* — and
it consumes seven buckets exactly. A hard-then-cool-down shape (Saturday as the
summit, Sunday a gentle victory lap) is a genuinely nice alternative rhythm, but it
is **non-monotonic** and needs a bespoke Sunday; it is deferred to be adopted
deliberately if the flat ramp feels wrong in play, not smuggled in now.

## Consequences

- **`scoring.ts` is a new shared primitive.** `session.ts` imports its scoring
  symbols instead of defining them; curation gains a `difficulty` that reuses them.
- **The difficulty knob before the scheduler.** The first consumer is a throwaway
  terminal REPL knob that lets a human *feel* an easy vs. hard Puzzle and check that
  the metric tracks perceived difficulty — because the whole model rests on an
  untested assumption that rare-word Score-mass ≈ felt difficulty. The full daily
  scheduler (calendar, deterministic "today", timezones, no-repeat) is deferred and
  will be built on this metric once it is validated.
- **Buckets are quantiles now, fixed thresholds later.** The candidate Difficulty
  distribution is unknown, so the knob slices the 325 candidates into 7 equal-sized
  quantile buckets (every bucket guaranteed populated). A quantile "Saturday" means
  "hardest seventh of whatever candidates exist," which drifts if the pool changes —
  so once play reveals the real distribution, the buckets are frozen into **fixed
  absolute Difficulty thresholds** in the scheduler, so a Saturday is a Saturday
  forever.
- **Difficulty is now ubiquitous language.** Added to the CONTEXT.md glossary.

## Deferred / rejected for v1

- **A concentration / findability term** — the "one long common word is 30% of the
  points; miss it and you cannot reach Genius" kind of hard. Real, but a different
  axis from knowledge-difficulty. Excluded from v1; revisit only if playtesting shows
  the rarity metric mis-ranks Puzzles.
- **Recall (tip-of-the-tongue) difficulty** — how hard it is to *think of* a rhyme at
  all, even a common one. Not cleanly measurable from the data; proxied by
  knowledge-difficulty and left to the human curation pass ADR-0003/0004 already call
  for.
- **A continuous knownness gradient for Difficulty** — rejected above.
- **The Saturday-peak / Sunday cool-down curve** — deferred above.
