# The game does not adjudicate contrasts a General American listener cannot hear

CMUdict encodes contrasts at a finer resolution than the ear. Read literally, every sub-perceptual distinction is promoted to a confident binary verdict — which is why `talked` was rejected for `docked`, a difference the maintainer could not hear across repeated TTS replays. A **normalisation** stage therefore rewrites the stored pronunciations once, at index-build time, before any Rhyme Key is computed, erasing contrasts a General American listener cannot resolve.

The Rhyme rule is unchanged. Rhyme is still the sounds from the last stressed vowel to the end of the word (ADR-0001); what changes is the reading that rule is applied to. This ADR amends ADR-0001's claim that the rule needs no interpretation layer, and amends ADR-0002 to say *which* General American the game speaks.

## The admissibility test

> A normalisation is admissible only if the contrast it erases is unavailable to a General American listener, **and** only if the guardrail set survives intact.

As written this covers a rule that *replaces* a reading. A rule that *appends* one
erases no contrast, so the first half has nothing to bite on; see the
[Amendment](#amendment-2026-07-30-the-bar-depends-on-whether-the-rule-replaces-or-appends).

The guardrail set is committed as a table in `src/__tests__/normalisation-guardrails.test.ts`: `chocolate`, `private`, `climate`, `senate`, `accurate` and `commensurate` must still fail against `ate`, and `for`/`far`, `born`/`barn` and `cord`/`card` must still fail against each other. The first group is the contrast everybody hears — a full vowel against an unstressed schwa — and is the case ADR-0001 was built on. The second is the one exclusion the low-back merge carries.

That table, not this prose, is the enforcement mechanism. A rule that breaks a row has overreached, and the rule goes, not the row. The test exists so this layer cannot drift into accepting everything, which is the failure mode that would make the game feel like it has no standards.

## Considered Options

**Do nothing; show the player the reading instead (#55).** Rejected — already tried. A player told the game hears `"TAWK-t"` for `talked` still believes it rhymes with `docked`, because in their accent it does. Making the disagreement legible does not make it feel just.

**Compare Rhyme Keys through a merge table at adjudication time.** Rejected. The verdict and the respelling would then come from different readings: the game would accept `talked` for `docked` and print `"TAWK-t"` beside `"DAH-kt"`, so an acceptance still reads as a mystery. It also spreads accent knowledge across every consumer of a Rhyme Key — respelling, tiering, curation — instead of confining it to one build stage.

**Append the merged reading as a variant rather than replacing it.** Rejected for a merge specifically. A variant makes every affected word an accidental homograph: `talked` would carry two Rhyme Keys, so `isAmbiguous` reports true and `pinSeed` demands disambiguation for hundreds of words that are not ambiguous at all. The base reading also stays first, so a Seed Word would still be spoken and respelled with the unmerged vowel. Appending remains the right shape for a normalisation that only *adds* a possible reading; a merge is a claim about which vowel is actually there.

**Merge `AO` into `AA` everywhere, including before `R`.** Rejected on measurement (see below). 55% of all `AO` tokens in the playable lexicon sit before `R`, so a blanket merge is mostly *not* the cot–caught merger at all. It takes the `far` family from 104 members to 236, admitting `for`, `car` and `jar` as rhymes for one another, and collapses `born`/`barn` and `cord`/`card` outright. Pre-lateral position is a different matter and is deliberately included — `ball` rhymes with `doll`.

### The measurement

Over the playable lexicon — every surface form in `data/cmudict.dict` that passes the wordhood gate and is not a name, after the committed supplement — counting `AO` tokens across all readings:

| | tokens | share |
|---|---|---|
| `AO` total | 4,636 | |
| `AO` immediately before `R` | 2,556 | **55.1%** |

And the `far` family (Rhyme Key `AA R`), built with `buildPuzzle`:

| | members |
|---|---|
| with the pre-rhotic exclusion (shipped) | 104 |
| blanket merge | 236 |

Reproduce by parsing `data/cmudict.dict`, applying `applySupplement`, and counting phonemes where `bareSound(p) === "AO"` against those whose successor is `"R"`. The raw data is uncommitted (ADR-0003), so this cannot be a test in the suite; the shipped behaviour it justifies *is* tested, in `src/__tests__/normalisation-guardrails.test.ts`. The figures differ slightly from the ones quoted in the originating issue (57%, a 125-word family), which were derived over a differently-scoped lexicon; these are the ones the implementation reproduces.

## Consequences

- **The merge replaces the reading.** The respelling layer renders `AA` as "ah" and `AO` as "aw", so replacing is what makes an accepted rhyme visibly *read* as a rhyme: `talked` respells `"TAH-kt"` against a Seed respelled `"DAH-kt"`.
- **Ordering is part of the contract**: committed supplement, then coverage derivation, then normalisation. The supplement asserts *readings*; normalisation asserts the *accent*. A hand-authored correction is therefore an input to the accent specification, not an exemption from it. Recorded in `src/normalise.ts` and `docs/data.md`, because a sibling epic inserts a stage into this sequence.
- **The stage is the only new seam.** Rhyme Key computation, respelling, tiering, Puzzle building, adjudication and curation are untouched and unaware of it — they receive ordinary pronunciations.
- **Each rule carries the perceptual claim that justifies it**, so a reviewer can challenge the claim rather than the code, and dropping a rule from `RULES` measures its contribution.
- **A player without the merger will meet verdicts they disagree with.** `stock` now rhymes with `stalk`. This is the cost ADR-0002 already accepts for choosing an accent at all — normalisation only names which variety was chosen.
- **Browser TTS will diverge** on the affected words: speech is fed the Seed Word's spelling, so it will say `"TAWK"` while the screen shows `"TAHK"`. Accepted; the contrast is close to inaudible to merged speakers, and the speech module already names the respelling as the source of truth.
- **Contrasts nobody has complained about stay adjudicated.** The Mary–marry–merry merger is admissible under the perceptual half of the test and is still left out, on the evidence discipline that gates everything else here: 18 keys, 262 words, zero complaints. Admissibility is a floor, not a mandate.

## Amendment (2026-07-30): the bar depends on whether the rule replaces or appends

The admissibility test above asks one question — *is the contrast it erases
inaudible?* — and that question is only well-formed for a rule that **replaces** a
reading. Two of the three shipped rules **append** one, and they erase no contrast
at all. Asked of the syllabic consonant or of stress promotion, the test has no
answer, which is why stress promotion's third limit reads as an anomaly: its
justification is morphological, and there was no bar for it to be obeying.

The distinction is not new here. This ADR's own rejected option already says
"appending remains the right shape for a normalisation that only *adds* a possible
reading; a merge is a claim about which vowel is actually there." It named the
mechanical split and then wrote the test in only the merge's terms.

The test is therefore two tests, one per shape. The guardrail half is unchanged and
governs both:

> A **replacing** normalisation destroys information — one reading survives where
> two stood — and is admissible only if the contrast it erases is unavailable to a
> General American listener.
>
> An **appending** normalisation destroys nothing: the base reading survives, first
> and untouched, so the rule can only turn a rejection into an acceptance. It
> cannot be justified by inaudibility, because it erases no contrast. It is
> admissible only if its **reach has been measured over the playable lexicon and
> its error rate stated**.
>
> Either way, the committed guardrail set must survive intact.

An appending rule needs the second bar because its perceptual claim does not limit
it. "No listener can hear a stress digit" is true, and it is equally true of
`candidate` and of `cities` — yet promoting the first is right and promoting the
second puts 652 words in one key. A merge's claim is self-limiting: it reaches
exactly the `AO` tokens and no others. An appending rule's claim tells you it is
right about *something* and nothing about where it stops, so the stopping point is
set by measurement and may be non-perceptual. Both appending rules found their
final limit exactly this way, and both say so in their docblocks.

### Why not "the data is defective"

The tempting framing was that an appending rule *repairs* a mis-transcription — that
CMUdict broke its own convention and the rule restores it. `candidate` is the
perfect case for it: CMUdict writes the full reading `K AE1 N D AH0 D EY0 T` with a
`0`, carries the reduced reading separately as `candidate(2)`, and marks the
identical syllable `EY2` in eleven sibling words (`advocate`, `estimate`,
`delegate`, `duplicate`, `moderate`, `separate`, `graduate`, `associate`,
`alternate`, `deliberate`, `elaborate`). Read from that one word, the `0` is
plainly a slip.

Rejected on measurement. Over the 718 key-gaining promotions in the playable
lexicon, classifying each by how CMUdict marks the *same* final-syllable shape
(bare vowel plus coda) elsewhere:

| | promotions | share |
|---|---|---|
| shape marked stressed ≥90% elsewhere | 402 | 56.0% |
| shape mixed, 50–90% stressed | 267 | 37.2% |
| shape usually marked *unstressed* | 49 | 6.8% |

And the `candidate` signature is rare: only **92** of the 718 have any
reduced-vowel reading among their raw entries, while **638** have a single raw
CMUdict entry and so offer nothing to corroborate a defect against. CMUdict is
*inconsistent* about these shapes rather than holding a convention the rule
restores, so "repair" claims more than the data supports and is not the bar.
Reproduce with the same method as the measurement above; the raw data is
uncommitted (ADR-0003), so this cannot be a test in the suite.

### Consequences

- **`Merge` and `append` are the vocabulary, and no new term is introduced.** A
  candidate name for the appending kind (`Repair`) was dropped with the framing
  that motivated it.
- **Stress promotion's third limit is compliant, not anomalous.** A limit on an
  appending rule controls reach, so it answers to measurement rather than to the
  ear, and that limit was measured — 1,719 words reached with roughly 945 wrong
  before it, and the 991 it excludes include about 45 it should have kept.
- **The stated error rate is part of the rule, not an embarrassment.** The 6.8%
  above is what this bar asks a rule to disclose. Two known groups inside it are
  tracked separately as defects rather than accepted: `-os` plurals CMUdict
  transcribes with `S`, and a rule-composition bug where the syllabic consonant
  manufactures a multi-consonant coda out of a suffix.
- **The title of this ADR now under-describes it.** It is kept, because renaming
  the file would break every inbound link; the file is the accent specification,
  of which erasing inaudible contrasts is one half.
