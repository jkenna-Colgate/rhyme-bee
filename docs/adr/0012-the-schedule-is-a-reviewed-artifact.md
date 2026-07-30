# The schedule is a reviewed artifact, not an automated eligibility gate

Seed eligibility has been built as a stack of automated gates: a size band
([ADR-0004](./0004-puzzles-are-bounded-by-seed-curation.md)), a distinctness gate
([ADR-0008](./0008-seeds-need-native-rhyme-content.md)), and a Difficulty metric
to order them ([ADR-0007](./0007-difficulty-is-rare-word-score-mass.md)). Three
more gates were queued behind them — a knownness floor for Seeds (#59), sharing
the suffix inventory with the Shadow Key detector (#88), and a native-content
threshold to sweep the thin survivors (#89).

**Those three are not built.** The surviving Seed pool is a **finite list of 294
keys**, small enough to be read once by a person, and the schedule is a committed
artifact — `data/schedule.json`, mapping date to Seed Word — reviewed in a single
sitting and thereafter fixed.

This does not retire the gates that exist. ADR-0004's band and ADR-0008's Shadow
Key filter did the coarse work — together they cut the in-band pool by roughly a
quarter — and they still produce the list. It retires the *next* gate, and the one
after that.

## Why a person, at this size

The gates are good at what is countable and bad at what is obvious. That
asymmetry is the whole argument, and the current pool demonstrates it: at the
default band, in-band candidates today include the representatives `ah`, `og` and
`aud`. Those Seeds would be **shown and spoken** to a player
([ADR-0002](./0002-general-american-is-the-only-accent.md) makes speaking the
Seed load-bearing) and they are not words. ADR-0008's own Measurement predicted
this — it describes the gray band as "almost all shadows wearing a costume", the
lone native usually a proper noun, a foreign form or an interjection — and #89
measured 54 of 294 surviving on one to three such words.

Every gate proposed to fix this is a rule inferring *is this a word a person would
recognise as a Seed* from countable proxies. A person answers it by looking, in
about a second, with no false positives. At 365 Seeds a year the automation earns
nothing: the pool is read once, and the decisions do not recur.

The cost is stated plainly: the maintainer must actually do the review, and a
Seed nobody vetoed ships. That is acceptable because the review is one sitting and
because a bad Seed is recoverable — the schedule is a data file, and swapping a
day is an edit.

## The banded deal

`CONTEXT.md` requires a Puzzle's Difficulty to ramp monotonically **within** a
week, Monday easiest to Sunday hardest, and says nothing about across weeks.
294 candidates is 42 × 7 exactly.

Sort the pool by Difficulty (ADR-0007: the share of a Puzzle's maximum score held
in rare Answers). Split into **seven contiguous bands of 42**. The easiest band
supplies every Monday, the next every Tuesday, and the hardest band every Sunday.
Order within a band is free.

Because the bands do not overlap, `Mon < Tue < … < Sun` holds for **every week by
construction** — it is a property of the deal, not something to be tested for and
maintained. Weeks stay comparable to one another, so the weekday signal means the
same thing in month nine as in week one.

## Considered Options

**Contiguous chunks — seeds 1–7 are week one, 8–14 week two.** Rejected. Each
week ramps, but the weeks also ramp across the year: week one is trivial, week 42
is punishing, and a Tuesday late in the run is harder than a Sunday early in it.
That makes the weekday signal noise, which is the one thing the ramp exists to
prevent.

**Build the remaining gates (#59, #88, #89's threshold) and keep the pool
automated.** Rejected. Each is defensible alone and the stack has no endpoint —
the same scope failure recorded in
[ADR-0011](./0011-reading-manufacture-is-frozen.md), reached from the curation
side. The gates are also strictly weaker than the review they would substitute
for: none of them rejects `og`.

**Generate the schedule a week at a time.** Rejected. It converts a one-time
review into a recurring chore, and it forfeits the property that makes the deal
work — the banded split needs the whole ordered pool in hand.

**Raise ADR-0008's native-content threshold from 0 to 2 or 3.** Rejected as a
substitute for review, though the knob stays available. It sweeps out costumed
shadows and also the genuine small families ADR-0008 names — `IH L D`
(`build, child, wild`), `AE P S` (`lapse, perhaps`), `IH P S` (`eclipse,
apocalypse`). A reviewer keeps those and drops the junk; a threshold cannot tell
them apart.

## Consequences

- **Closed as won't-do:** #59 (knownness floor for Seeds), #88 (share the suffix
  inventory with the Shadow Key detector), and #89's second cause (thin native
  content). All three are superseded by the review.
- **#89's first cause survives, and is not a curation issue.** `heinz`,
  `versailles`, `algiers`, `marx`, `rhodes`, `schwarz` hold **wordhood**, so they
  are accepted as *Answers* — and CONTEXT.md says a Proper Noun is never valid,
  however well it rhymes. That is an adjudication defect (the class of #51,
  `troy`), fixed in `data/names.txt`. Scope it to the names that measurement
  found, not to making the filter correct; the second reading is an unbounded
  backlog wearing a data-fix costume.
- **The schedule pins Seed Words, so a rebuild cannot reshuffle the calendar.**
  It can still move a scheduled Seed's answer count out of band or change its
  Difficulty. Accepted: after review, band membership is advisory, and the daily
  play-ahead is what surfaces a Puzzle that has drifted.
- **Review binds only if the build is deterministic.** #75 pins a Seed to a real
  dictionary reading reproducibly across rebuilds; without it, the Seed approved
  last night can be *spoken* differently today, and approval guarantees nothing.
  This is why #75 outlives the curation machinery around it.
- **The pool figure has moved and will move again.** ADR-0008's Resolution
  recorded 245 candidates; it is 294 now, because coverage derivation (#76, #77)
  gave 7,433 words a reading and changed family sizes. The schedule is generated
  once from the pool as it stands at review time; it is not rederived.
- **ADR-0004's widen-the-band lever is untouched.** At 42 weeks the library is
  under ten months, so the run ends before a repeat is needed. Widening to
  [10, 120] remains pre-approved if a second year is wanted.
