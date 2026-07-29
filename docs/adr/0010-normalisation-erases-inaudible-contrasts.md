# The game does not adjudicate contrasts a General American listener cannot hear

CMUdict encodes contrasts at a finer resolution than the ear. Read literally, every sub-perceptual distinction is promoted to a confident binary verdict — which is why `talked` was rejected for `docked`, a difference the maintainer could not hear across repeated TTS replays. A **normalisation** stage therefore rewrites the stored pronunciations once, at index-build time, before any Rhyme Key is computed, erasing contrasts a General American listener cannot resolve.

The Rhyme rule is unchanged. Rhyme is still the sounds from the last stressed vowel to the end of the word (ADR-0001); what changes is the reading that rule is applied to. This ADR amends ADR-0001's claim that the rule needs no interpretation layer, and amends ADR-0002 to say *which* General American the game speaks.

## The admissibility test

> A normalisation is admissible only if the contrast it erases is unavailable to a General American listener, **and** only if the guardrail set survives intact.

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
