# An appending rule's reach is measured net of upstream data errors

ADR-0010's amendment bars an **appending** normalisation unless "its reach has
been measured over the playable lexicon and its error rate stated". Both numbers
can be satisfied in full by a rule whose measurable reach is almost entirely a
consequence of errors in the upstream readings — and such a rule scores *well*,
because the verdicts it produces are correct. The bar then certifies a rule for
work `data/supplement.dict` exists to do one word at a time.

Reach is therefore measured **net**: the population excludes any verdict a
per-word supplement correction would produce anyway. A rule is admitted on the
verdicts that survive that subtraction.

This amends ADR-0010's appending bar. ADR-0001 is untouched, and ADR-0011's
freeze is not invoked — nothing here changes a reading or a rule.

## The measurement

Over `main` at `d17f082`, via `scripts/measure-syllabic-reach.ts`, for the
syllabic-consonant rule as it ships after #209's two conditions:

| | words |
| --- | --: |
| playable words the rule rewrites | 5,018 |
| ...of which gain a new rhyme partner | 1,038 |
| ...of which gain one of eight partners below | **1,005 (96.8%)** |
| unexplained residue | **33** |

The population is enumerated by effect — the build runs twice, once stopping
short of normalisation — so the count follows the rule rather than restating it.
Full figures and method in `docs/measurements/syllabic-consonant.md`.

### How the 872 arise

`coarticulation` gains 872 `-ation` words. CMUdict marks its `-ation` vowel
unstressed where the same syllable in `articulation` carries primary stress:

```
articulation      AA2 R T IH0 K Y AH0 L EY1 SH AH0 N        ← EY1
coarticulation    K OW2 AA0 R T IH1 K Y UW0 L EY0 SH AH0 N  ← EY0, upstream
                  K OW2 AA0 R T IH1 K Y UW0 L EY0 SH N      ← syllabic consonant drops the schwa
                  K OW2 AA0 R T IH1 K Y UW0 L EY2 SH N      ← stress promotion fires on the new coda
```

Only the third reading carries the Rhyme Key `EY SH N`, and only through it do
the 872 words reach the word. The schwa drop does not produce the rhyme; it
manufactures the coda that licenses stress promotion, which produces it. That
composition is #86, which ADR-0010's amendment lists as a defect tracked inside
its 6.8%. It is not a fraction of the error rate. It is where most of this
rule's measurable population comes from.

By ADR-0001 a Rhyme Key starts at the last stressed vowel, so a corrected
`EY1` would give `coarticulation` the key `EY SH AH N` — `nation`'s key —
natively. The 872 words rhyme with it either way. The rule contributes the
verdict only because the reading is wrong. (Deduced from the Rhyme Key rule; the
index was not rebuilt to confirm the words then leave the population.)

### The eight partners

| partner gained | population words | what it is |
| --- | --: | --- |
| coarticulation | 872 | `EY0` where `articulation` has `EY1` |
| subsection | 58 | `EH0` where `section` has `EH1` |
| rectangle | 14 | `AE0` where `tangle` has `AE1` |
| charwoman | 13 | `UH0` where `woman` has `UH1`, `assemblywoman` `UH2` |
| newswoman | 13 | same morpheme, same mark |
| forewoman | 12 | same morpheme, same mark |
| tucuman | 12 | a province in Argentina, in `words` rather than `names` |
| barrowman | 11 | `OW0` on the `barrow` stem |

Seven are stress marks contradicted by a sibling word in the same index. The
eighth is a wordhood leak and belongs to a Demotion. None is a claim about what
a General American listener can hear, which is the only kind of claim the
normalisation layer exists to make.

## Considered options

**Correct the eight readings, rebuild, and measure the residue.** Rejected, and
the rejection is the point. This would have been the fifth measurement of this
rule's reach; the four before it returned 5,604, then 1,086, then 1,038, then
1,005-of-1,038, each an order of magnitude smaller than the framing it replaced,
and each ended by proposing the next one. The decision does not need the fifth
number. A bar that certified this rule on a population of 1,038 when the honest
figure is at most 33 is broken at any residue.

**Keep the rule and call the repair a justification.** Rejected, and ADR-0010's
amendment already rejected it in the other direction — it dropped `Repair` as a
name for the appending kind after measuring that CMUdict is *inconsistent* about
these shapes rather than holding a convention a rule restores. That measurement
was a group classifier over 718 promotions. This one is eight words, each read
against a named sibling, so it establishes something the classifier could not:
not that the data is defective in general, but that this rule's specific
population is. Where repair is what an appending rule is observably doing, the
work belongs in the supplement, which ADR-0009 established for mis-marked stress
and names `viceroy` and `bratwurst` as its cases.

**Add a further condition to the syllabic-consonant rule.** Rejected. Every
condition the rule carries was measured against a population that is 97%
artefact, so the conditions were tuned on the wrong object. #209's two limits
stay provisional for that reason.

## Consequences

- **The appending bar gains a third clause.** Reach measured, error rate stated,
  and the reach **net** of verdicts a supplement correction would produce anyway.
  A rule whose net reach is small is a rule to remove, not to condition.
- **An error rate over a gross population measures the data, not the rule.** The
  100-row sample drawn for #211 would have returned roughly 89 correct verdicts
  and an error rate near 11%, all of it a reading on CMUdict's stress marking.
- **The syllabic-consonant rule's unexplained population is 33 words.** Whether
  it earns its place is now settled by reading a list, not by sampling one.
  Enumerate; do not estimate.
- **#86 is reclassified.** ADR-0010's amendment tracks it as a defect inside the
  stated error rate. It is the mechanism behind most of the syllabic-consonant
  rule's measurable population, and the two rules are measured together or not
  at all.
- **The guardrail set is untouched.** No row changes, and
  `src/__tests__/normalisation-guardrails.test.ts` is not modified by this ADR.
- **`tucuman` is a Demotion**, not a phonology question, and is recorded here
  only because it sat in a table of stress marks.
