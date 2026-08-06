# A Seed Word must have native rhyme content, not be an inflection shadow of another Seed

A Rhyme Key is eligible to be a **Seed Word** only if its family contains
**native** words — words that are *not* a regular inflection (`-s/-es/-ed/-ing`)
or affixed form (`un-/re-/out-/…`) of a word in another Rhyme Key. A key whose
members are *entirely* derived — call it a **shadow key** — is barred from the
Seed pool. `downs` (`AW N Z`) is a shadow of `down` (`AW N`): 23 of its 27
members are literally a `down`-family word with an `s` stapled on, and it has zero
native identity of its own. Inflected and affixed words remain perfectly valid
**Answers**; this rule governs only what may be a *Seed*.

This **refines [ADR-0004](./0004-puzzles-are-bounded-by-seed-curation.md)**. That
ADR bounds the Seed pool by answer-count band — a *size* gate. This adds a second,
orthogonal *distinctness* gate within the band: a Puzzle can be perfectly sized and
still be a rerun of another Puzzle in a different suit.

## The problem it prevents

Without this gate, `down` and `downs` are two separate in-band candidates (they
have different Rhyme Keys), so the schedule can serve them on consecutive days.
But the `downs` board is the `down` board with `+s` on every word: `browns,
clowns, crowns, frowns, gowns, downtowns, crackdowns…`. Solving Monday's `down`
and then Tuesday's `downs` is solving the same puzzle twice with a suffix — the
single most deflating thing a daily word game can do. This is not a rare edge:
measured over CMUdict at the default band, **~18% of candidate keys are pure
shadows** (see [Measurement](#measurement)).

## Why the obvious filters are wrong

- **"Exclude inflection-heavy keys."** Too blunt — it destroys real puzzles. The
  key `AY N D` is 65 words, a clear majority of them `-ined` past tenses
  (`aligned, combined, confined, defined…`) — but it *also* holds `bind, blind,
  find, mind, kind, grind, behind`. That is the `blind/mind/find` board, one of
  the best in the set. Inflection *density* is not the signal.
- **"Exclude by answer count."** Orthogonal — shadows come in every size, and
  size is already ADR-0004's job.

The thing that makes `downs` a bad Seed and `AY N D` a good one is **native
content**: `AY N D` has a large body of underived base words; `downs` has none.
A shadow key is definitionally *another key's family plus an affix* — it carries
no rhyme experience the base key doesn't already carry.

## Why native content, and not G2P (the road not taken)

This rule closes a door we opened chasing a different bug. The original complaint
was that submitting `midtowns` to the Seed `downs` returned `does-not-rhyme` — a
CMUdict coverage gap (`midtown` is in the dictionary, `midtowns` is not). The
tempting fix was a grapheme-to-phoneme layer that *derives* pronunciations for
missing inflections, so `midtowns` would be accepted.

That fix is now unnecessary, because the two problems are the same problem seen
twice. The **only** reason a player needs `midtowns` accepted is that `downs` is a
Seed — and `downs` is exactly the derivative Seed this ADR removes. With shadow
keys barred:

- No one is ever asked to rhyme with `downs`, `books`, or `kings`.
- The base Seed `down` already accepts `midtown`, `comedown`, `breakdown` — all
  present in CMUdict — as native Answers.

So a curation filter (offline, no new data, high precision) replaces a G2P project
(a runtime dependency that occasionally invents wrong pronunciations). The
residual — completing Answer sets on surviving *base* Seeds that end in a sibilant,
where a natural plural rhyme is missing from CMUdict (`pause` → a missing `-s`
plural) — is a far smaller, separable question, deferred rather than solved here.

## What counts as "derived"

A word is **derived** if it is either:

- a regular inflection of a dictionary word — `-s / -es / -ies / -ed / -ing`
  (`downs←down`, `combined←combine`, `aiding←aid`); or
- an affixed form of a dictionary word — a common prefix (`un-, re-, out-,
  over-, mis-, non-, under-, inter-, …`) on a real base (`unaided←aided`,
  `outstanding←standing`).

Both suffix and prefix stripping are required. With suffix stripping alone,
`unaided` and `outstanding` masquerade as *native*, and the shadow keys they sit
in wrongly survive. The detector is the same morphological machinery
`lemmatise.ts` already applies in reverse for knownness; this extends it with a
prefix pass.

A key's **native content** is the count of its members that are not derived. The
eligibility rule is: **native content `== 0` → drop as Seed.** The threshold is a
knob (see Consequences); zero is the unambiguous floor.

## Measurement

Computed offline over CMUdict + the common-word list, grouping wordhood-valid
words by Rhyme Key at the default band [20, 120]. (These counts are on a
family-*size* proxy for candidacy; the exact figure at the answer-count band of
[ADR-0004](./0004-puzzles-are-bounded-by-seed-curation.md) — 325 candidates — is
produced when the filter lands in the curation path, and recorded in a Resolution
then.)

| native base words (after prefix **and** suffix strip) | keys |
|---|---|
| 0 → pure shadow (drop) | **74  (~18%)** |
| 1–2 | 52 |
| 3–5 | 20 |
| 6+ → solidly distinct (keep) | **273** |

The gray band (1–5 native) is, on inspection, almost all shadows wearing a
costume: the lone "native" is usually junk — a proper noun (`marx, keats,
algiers`), a foreign word (`mesdames, messieurs, etudes`), or an interjection
(`zounds, congrats`) — not a puzzle-anchoring English word. The genuinely
keep-worthy gray-band keys are a small, nameable handful with real underived
content: `IH L D` (`build, child, wild, mild, guild`), `AE P S` (`lapse,
collapse, perhaps, relapse`), `IH P S` (`eclipse, ellipse, apocalypse`).

## Consequences

- **The Seed pool shrinks, distinctness rises.** Roughly 18% of in-band keys leave
  the pool; every remaining Puzzle stands on its own rhyme family. The exact
  post-filter candidate count is tracked as part of the library-size concern
  ADR-0004 already carries, and — like the band floor there — the shrinkage is
  absorbable by ADR-0004's pre-approved lever of widening the band to [10, 120] if
  the library dips too low.
- **The detector extends `lemmatise.ts` with a prefix pass.** This is the one new
  piece of logic; it must catch both inflection and affixation or the filter leaks.
- **Answers are untouched.** Inflected/affixed words remain fully valid Answers
  wherever they rhyme (`pause` still accepts `laws, jaws, straws`). Only *Seed
  eligibility* is constrained.
- **The threshold is a knob, defaulting to 0.** `native == 0` is the safe,
  defensible cut. Raising it to `≤1` or `≤2` sweeps out more costumed shadows at
  the cost of a few genuine small families; the handful of real keeps in the gray
  band (`build/child`, `lapse/perhaps`, `eclipse`) can be pinned via curation's
  existing allow path rather than by moving the threshold.
- **The #25 demo Seed is reclassified.** `books` (`UH K S`) is a shadow of `book`
  and would no longer be a scheduled Seed; `book` — the stronger board — takes its
  place. Any docs or tests that hard-code `books` as a sample Seed need updating.
- **A data-quality lever surfaces alongside.** Much of the gray-band junk (`marx,
  keats, algiers, versailles`) are proper nouns slipping past the names filter.
  Tightening that filter pushes those keys into the clean pure-shadow bucket and is
  worth doing, but is orthogonal to this decision.
- **`Shadow key` / native content join the ubiquitous language.** Added to the
  CONTEXT.md glossary.

## Deferred / rejected

- **Inflectional grapheme-to-phoneme (deriving `midtowns`' pronunciation).**
  Rejected as the primary fix: made unnecessary for Seeds by this rule, and a
  heavier, lower-precision mechanism than a curation filter. May still be revisited
  *only* to complete Answer sets on surviving sibilant-ending base Seeds, if
  playtesting shows the holes bite.
- **One genuine edge case, accepted:** a rhyme family whose *singular* key is
  below band but whose *plural* shadow lands in band would be dropped entirely,
  removing that rhyme experience from the game. It is rare (a plural key in band
  while its base is not implies the plural pools extra compound members), and for a
  for-fun daily we accept the loss rather than special-case it.

## Resolution (2026-07-26)

The filter now runs in the production curation path (a native-content pass over the
grouped Rhyme Keys, using the derivation detector `isDerived` in `lemmatise.ts`,
which strips both inflection and a common-prefix affix against the wordhood word
list). Measured by `npm run histogram` at the default band [20, 120]:

- **80 in-band keys are pure Shadow Keys** (native content `== 0`) and are dropped
  with the distinct reason `shadow-key`.
- The candidate Seed pool falls from **325 → 245** — the 325 in-band keys of
  [ADR-0004](./0004-puzzles-are-bounded-by-seed-curation.md)'s Resolution, less
  those 80 shadows. So **~24.6%** of in-band keys were shadows — higher than the
  ~18% the family-size proxy in [Measurement](#measurement) estimated, because the
  answer-count band concentrates the large plural families that are most likely to
  be shadows.

Spot-checks confirm the intent: `downs` (`AW N Z`) and `books` (`UH K S`) drop as
`shadow-key` with zero native content; `down` (`AW N`, 52 native), `AY N D`
(`bind/blind/mind/find`, 16 native) and `EY S T` (`taste/waste`, 12 native) remain
candidates.

At 245 puzzles the library is still ~eight months of never-repeat daily play —
comfortably above the ~80-family floor ADR-0004 worried about, and its pre-approved
lever (widen the band to [10, 120]) remains available if the pool ever dips too low.

## Amendment (2026-07-30): *derived* includes derivational suffixes

**The definition in [What counts as "derived"](#what-counts-as-derived) widens: a
word is also derived when it is a **configured derivational suffix** on a real base
— `-ly, -ness, -er, -est, -ish, -ful, -less, -ment` and the `-edly` / `-edness`
variants, the inventory `src/affixes.ts` configures.** The clause above names only
inflections and prefixes because, when this ADR was written, those were the only
affixes the build knew about. Issue #77 added a suffix inventory, and three
suffix-only keys are now sitting in the Seed pool.

### The gap is live, not hypothetical

Measured over the current build at the default band [20, 120] — 294 candidates, 91
already dropped as Shadow Keys — exactly three candidates lose *all* native content
once suffixes count. Every member of all three is an adjective or participle plus
`-ly`:

| Rhyme Key | representative | members | in the pinned data | given a reading by #77 |
|---|---|---|---|---|
| `EH N SH AH L IY` | `essentially` | 23 | 10 | 13 |
| `EH N T AH L IY` | `parentally` | 24 | 13 | 11 |
| `EY T IH NG L IY` | `dominatingly` | 30 | 4 | 26 |

`EH N SH AH L IY` is the `essential / potential / torrential` board with `-ly` on
every word — `downs` in a different suit, and the exact thing this ADR exists to
bar.

**#77 is what opened the gap.** Family size is an upper bound on Answer count, and
the pinned-data-only membership of the three keys is 10, 13 and 4 — all below the
band floor of 20. None of them could have been a candidate before the coverage
stage started composing `-ly` readings. So the suffix inventory did not merely
inflate keys that were already in band; it lifted three shadows into the pool.

The consequence is concrete rather than theoretical, and it has since stopped being
a matter of eligibility: the run dealt on 2026-08-04 **schedules all three keys**,
each on a different representative from the same family.

| date | Seed Word | Rhyme Key |
|---|---|---|
| 2026-10-09 | `devastatingly` | `EY T IH NG L IY` |
| 2027-02-18 | `essentially` | `EH N SH AH L IY` |
| 2027-03-29 | `experimentally` | `EH N T AH L IY` |

A Seed Word is *spoken* to the player at the start of a Puzzle, so on those three
days it is spoken from a composed reading.

### Why the relation is the same one

A Rhyme Key runs from the last stressed vowel to the end of the word, and every
configured suffix is stress-neutral, so the stressed vowel stays in the stem and
the derived key is always **the base key plus the suffix's phonemes**. This is
enforced, not merely observed: `suffixRule` refuses any composition whose key is
not the stem's key extended.

That makes base key → derived key a function, and an injective one — strip the
suffix's phonemes and the base key comes back. A suffix therefore maps a whole base
family one-to-one onto a single derived key, which is structurally identical to
`down` → `downs`. The rationale this ADR already rests on — *carries no rhyme
experience the base key doesn't already carry* — applies unchanged.

Keys that mix suffixed and native words are not caught by this and should not be:
the `-er` key holds `teacher` and `runner` alongside `water`, `mother` and
`finger`, keeps substantial native content, and survives. The threshold does that
work, so the inventory does not need trimming to protect them.

### The detector is morphological, not phonological

A tempting stronger test — accept a word as suffix-derived only when its own
reading *is* the stem's reading composed with the suffix — was measured and
rejected. It reclaims 752 words against the morphological test's 939, and flips
**zero** keys instead of three.

It under-fires for a reason that has nothing to do with rhyme. CMUdict's
disagreement between a stem and its own derived entry sits in the unstressed
syllables *before* the stressed vowel, outside the Rhyme Key entirely:

```
presidentially  P R EH2 S IH0 D EH1 N SH AH0 L IY0
presidential    P R EH2 Z AH0 D EH1 N SH AH0 L        S IH0 D  vs  Z AH0 D
excruciatingly  EH2 K S K R UW1 S IY0 EY2 T IH0 NG L IY0
excruciating    IH0 K S K R UW1 SH IY0 EY2 T IH0 NG   S IY0   vs  SH IY0
```

Five of the six misses have Rhyme Keys that match exactly. Whether a word is
derived is a question about morphology, and the answer does not become less true
because a lexicographer typed a different schwa three syllables upstream.

### What is unchanged

- **The eligibility rule.** Native content `== 0` → drop as Seed. Only the
  membership of *derived* moves. The detector does not read the suffix inventory,
  and now will not — see the Resolution below.
- **Answers.** Suffixed words remain fully valid Answers wherever they rhyme.
  `essentially` is still an Answer on the `EH N SH AH L IY` key; that key is
  merely barred from being a *Seed*.
- **[Why the obvious filters are wrong](#why-the-obvious-filters-are-wrong).**
  This is still not a density test. `AY N D` stays a Puzzle.
- **The 2026-07-26 Resolution's figures**, which record what was true then. The
  current build reads 294 candidates and 91 shadow drops.

### Resolution (2026-08-06): the definition widens, the detector does not

**Issue #88 — sharing the suffix inventory with `isDerived` — was declined, and the
three scheduled days above stand.** The definition in this Amendment is unchanged
and correct: those keys *are* Shadow Keys. The build simply does not act on it, and
that is now a decision rather than a gap.

The reason is cost, not doubt. Landing #88 drops the pool 294 → 291 and so forces
the run to be dealt again; a re-deal moves the Seed Word under every date after the
first change, and the schedule is a committed artifact the game ships inside its
bundle. Three days out of 260 — the first of them 2026-10-09, months past the
playtest — is not worth re-cutting the run and re-reviewing it.

So this is a **known and accepted deviation**: for these three days the shipped
schedule serves a Seed Word this ADR's own rule would bar. The days are named above
so that a report of one reads as expected behaviour and not as a new bug. What
makes them survivable is that the Puzzle is still *playable* — every member of the
key genuinely rhymes, the answer set is in band, and the only loss is that the
board is one family wearing a suffix rather than a fresh one.

Reopening #88 is the fix if it is ever worth a re-deal — most cheaply while the
schedule is being re-cut for some other reason anyway, when the marginal cost is
the review rather than the deal.

### A larger neighbour, deliberately not fixed here

The same measurement found **54 candidate keys surviving on one to three native
words**, where the survivor is overwhelmingly a proper noun or a foreign form that
slipped the names filter — `versailles`, `heinz`, `algiers`, `marx`, `azores`,
`mesdames`, `schmalz`, `franz`, `hertz`, `rhodes`, `bortz`, `schwarz`, `sheard`.
This ADR's [Measurement](#measurement) section predicted exactly that ("shadows
wearing a costume") and its Consequences name tightening the names filter as an
orthogonal lever. It gates more keys than the suffix gap does and is tracked as
issue #89; widening *derived* neither fixes nor worsens it.
