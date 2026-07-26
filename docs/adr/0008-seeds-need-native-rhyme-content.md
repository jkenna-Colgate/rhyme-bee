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
