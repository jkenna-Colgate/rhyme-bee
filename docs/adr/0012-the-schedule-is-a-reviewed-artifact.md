# The schedule is a reviewed artifact, not an automated eligibility gate

**Status:** amended 2026-10-11 and 2026-10-14. The Schedule is still read by a person rather than gated, but it no longer ends: it is a loop dealt once in whole weeks, grows by new weeks put through a Batch, and repairs a day whose Seed Word no longer pins (the same word on its current Rhyme Key, then the family's lead word, then Free Play). A Seed Word must be heard one way, and is never an Unconfirmed Rhyme. The Consequences about the run ending are reversed.

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

`GLOSSARY.md` requires a Puzzle's Difficulty to ramp monotonically **within** a
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
  are accepted as *Answers* — and GLOSSARY.md says a Proper Noun is never valid,
  however well it rhymes. That is an adjudication defect (the class of #51,
  `troy`), fixed in `data/names.txt`. Scope it to the names that measurement
  found, not to making the filter correct; the second reading is an unbounded
  backlog wearing a data-fix costume.
- **The schedule pins Seed Words, so a rebuild cannot reshuffle the calendar.**
  It can still move a scheduled Seed's answer count out of band or change its
  Difficulty. Accepted: after review, band membership is advisory, and the
  Editor's Pass is what surfaces a Puzzle that has drifted.
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

## Amendment, 2026-10-11: the Schedule is a loop

The Consequences above say the run ends before a repeat is needed, and hold
widening the band in reserve for a second year. Both are reversed. The game is to
run with nobody attending it (#218), so the Schedule cannot end, and Free Play is
never the plan for a date. Decided in #228.

**The Schedule loops, and nothing deals it again.** A date past the last
scheduled one shows the Seed Word played one lap earlier. The client works that
out from the date, as it does today. No job runs and no further file is
generated.

**The first loop is the last 259 days of the schedule as reviewed**: 37 whole
weeks, 2026-08-04 to 2027-04-19. Tuesday 2027-04-20 shows the Seed Word of
Tuesday 2026-08-04. The schedule is 260 days, one over a whole number of weeks,
so `lopsided` (2026-08-03) is left out and held as a spare.

**A lap is a whole number of weeks.** That keeps the banded deal true with nobody
checking it: a Seed Word returns on the weekday it was dealt to, so
`Mon < Tue < … < Sun` holds on every lap for the reason it held on the first.

**One place per Seed Word, and one per Rhyme Key.** `sentimental` was dealt twice
(2026-08-17 and 2026-11-11) because it has readings on two Rhyme Keys and led
both families. The second day takes `kennel`.

**The Schedule grows by whole weeks.** New Seed Words are read once, as this ADR
requires, go through a Batch
([ADR-0021](./0021-the-unattended-loop-calls-a-model-in-one-place.md)), and are
dealt among themselves into weeks of seven by the banded deal. A new week goes
anywhere after the week in progress. Weeks behind it are untouched and weeks
ahead of it slide later by seven days, so a place already given keeps its weekday
and comes round no sooner. Fewer than seven wait as spares. For that to hold, the
Schedule records the date the lap in progress began, and adding weeks moves that
date to the start of the current lap. A loop held only as a list and a length
would move every future date when the length changed.

**A Seed Word that no longer pins is repaired at the build, in order.** First the
same word on its current Rhyme Key (the one with the most Answers that the
Schedule does not already hold). Then the family's lead word. Failing both, the
day is Free Play and is counted against Continuity. The repair is written to the
schedule file, which stays the one place a date is pinned. This narrows "a
rebuild cannot reshuffle the calendar" above: a rebuild may re-pin one day, and
only a day that would otherwise have no Puzzle.

### Rejected

**Re-deal each lap, by a scheduled job or pre-generated for years.** A shuffle
can place a Seed Word late in one lap and early in the next, so the gap needs a
rule and a check of its own. The loop gets the gap and the ramp by construction.
A job must also be alive when the lap ends, and GitHub switches off a scheduled
workflow in a public repository after 60 days without activity.

**Grow the pool until a lap is a year.** The effort began by asking for a year
between repeats. Nothing measured depends on a year: the gap has to outlast a
player's memory of the Answers and give Session Records time to move Tiers, and
eight and a half months does both. A lap of 371 days needed about 113 more Seed
Words from the [10, 120] band, which is a read of 277 unvetted candidates and
about four more Batches, for Puzzles of 10 to 19 Answers. Widening stays
available as growth, taken when the maintainer wants more Puzzles. The Schedule
continuing does not wait on it.

**A bench of spare Seed Words for a day that cannot be repaired.** With nobody
attending, a whole family vanishes only through a change to Normalisation, and
[ADR-0011](./0011-reading-manufacture-is-frozen.md) holds those for the
maintainer.

**Re-band each lap as Difficulty drifts.** Tier moves and added readings change a
Puzzle's Difficulty between laps, so a Sunday can come to play like a Thursday.
Moving it is a re-deal. The drift is accepted on the terms this ADR already set
for the first lap: after review, band membership is advisory.

## Amendment, 2026-10-14: a Seed Word is heard one way

Settled in
[How do a judge's corrections land with nobody reviewing them?](https://github.com/jkenna-Colgate/rhyme-bee/issues/238).

**A word can be a Seed Word only if none of its other readings rhymes with a
word its pinned reading does not.** Where a reading came from (the dictionary,
the supplement, a Normalisation) does not matter. The Seed Word is spoken
([ADR-0002](./0002-general-american-is-the-only-accent.md)) so that the player
hunts on the reading the game adjudicates. A player who knows the other reading
hunts on that one instead and is rejected for it. 14 scheduled Seed Words have
more than one Rhyme Key, on 15 days.

**It is checked when a Seed Word joins the Schedule, and once now, and not at
every build.** It is also checked when the editor adds a reading to a scheduled
Seed Word in the Editor's Pass. A Seed Word that fails gives its day to
another by the repair order above, passing over the word that failed. The day
keeps its Rhyme Key, so it goes to the family's lead word and keeps its Puzzle,
or failing that is Free Play.

**Seed Words and Unconfirmed Rhymes are kept apart.** A scheduled Seed Word is
never listed as an Unconfirmed Rhyme for another Rhyme Key: the pair stays
rejected and its Candidate waits for an Editor's Pass. A word listed as an
Unconfirmed Rhyme cannot join the Schedule. So nothing swaps a Seed Word on the
Judge's word alone. If the editor confirms the Judge's ruling, the reading is
added in the ordinary way and the test above decides the day. The unattended
loop cannot reach this case by itself: the Judge writes a reading only for a
word with none, and a Seed Word always has one.

### Rejected

**List the Seed Word as an Unconfirmed Rhyme, and accept its family without
Points on its own day.** A Rhyme holds both ways, so an Unconfirmed Rhyme on a
Seed Word would make every word of the other family an accepted guess on that
Seed Word's day. A wrong ruling by the Judge is the likelier case, and a real
gap in the dictionary on a scheduled Seed Word should be rare once the Batches
have run. Keeping them apart costs one word rejected on one day per lap.
