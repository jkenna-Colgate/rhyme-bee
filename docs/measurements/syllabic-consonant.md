# The syllabic-consonant rule's error rate (#211)

The rule appends a schwa-less reading before a word-final `L`/`N`/`M`
(ADR-0010, #74). It has never had its error rate measured. This is the
measurement: a number, and no change to the game.

> **Superseded in part.** The concentration section below carried a false claim
> about CMUdict, and the sample built on it is withdrawn unjudged. The corrected
> finding is in [ADR-0018](../adr/0018-appending-reach-is-measured-net-of-data-errors.md).

## Population

Words the rule gives a **new Rhyme partner** — not words it rewrites. Measured
against `main` after #209's two conditions merged (`d17f082`), so this is the
rule that ships.

| | |
| --- | --: |
| playable words the rule rewrites | 5,018 |
| ...of which gain a rhyme partner | **1,038** |
| new rhyme pairs, from the rewritten side | 2,661 |

1,086 was the pre-#209 figure. It was counted without the upstream check this
script applies — a reading CMUdict already listed both ways is not the rule's
doing — and the comparable count here is 1,044, so #209's two conditions took
roughly 40 words out of reach and the check accounts for the other 6.

Reproduce with `tsx scripts/measure-syllabic-reach.ts`. The population is
enumerated by *effect* — the build is run twice, once stopping short of
normalisation — so a condition added to or removed from the rule changes the
count without the script being told.

## How concentrated it is

97% of the population is eight words' stress marks. **An earlier draft of this
section said CMUdict writes `coarticulation` without the schwa. That is wrong**
— the schwa is present. What is wrong upstream is the *stress*: CMUdict marks
the `-ation` vowel `EY0` where `articulation` has `EY1`, so the Rhyme Key starts
too early and the word does not reach `-ation` at all. The schwa drop then
manufactures a coda, stress promotion fires on it, and the promoted reading is
what 872 words rhyme with. See ADR-0018 for the full chain and the other seven.

| partner gained | population words |
| --- | --: |
| coarticulation | 872 (84.0%) |
| subsection | 58 (5.6%) |
| rectangle | 14 (1.3%) |
| charwoman | 13 (1.3%) |
| newswoman | 13 (1.3%) |
| forewoman | 12 (1.2%) |
| tucuman | 12 (1.2%) |
| barrowman | 11 (1.1%) |

A uniform sample of 100 therefore asks about five distinct claims, 89 rows of
one of them. That is a fact about the rule's reach, not a fault in the draw —
but it is what the error rate below is mostly measuring, and it is recorded
here so the number is read for what it is.

## The sample

100 words drawn uniformly at random from the population, seed 211, drawn and
committed before any verdict was entered. The partner shown is the best-known
one the word gains, so the row tests the sampled word's schwa rather than the
judge's acquaintance with the partner. Rows are in alphabetical order and carry
no window, class or reading: the minimal-pair test asks whether two words with
the *same* window can have opposite verdicts, and grouping the sheet by window
would answer that question by suggestion.

Judged by the maintainer, by ear, in General American. Direction does not
matter — the pair either rhymes or it does not.


| # | does this word | rhyme with this one | yes / no |
| --: | --- | --- | --- |
| 1 | accommodation | coarticulation |  |
| 2 | activation | coarticulation |  |
| 3 | acumen | forewoman |  |
| 4 | amputation | coarticulation |  |
| 5 | association | coarticulation |  |
| 6 | aviation | coarticulation |  |
| 7 | canonization | coarticulation |  |
| 8 | castration | coarticulation |  |
| 9 | codification | coarticulation |  |
| 10 | complection | subsection |  |
| 11 | computation | coarticulation |  |
| 12 | confederation | coarticulation |  |
| 13 | conjugation | coarticulation |  |
| 14 | consolation | coarticulation |  |
| 15 | corporation | coarticulation |  |
| 16 | declaration | coarticulation |  |
| 17 | defection | subsection |  |
| 18 | denationalization | coarticulation |  |
| 19 | depravation | coarticulation |  |
| 20 | desecration | coarticulation |  |
| 21 | determination | coarticulation |  |
| 22 | discontinuation | coarticulation |  |
| 23 | disincorporation | coarticulation |  |
| 24 | disinflation | coarticulation |  |
| 25 | disinformation | coarticulation |  |
| 26 | dissection | subsection |  |
| 27 | dissemination | coarticulation |  |
| 28 | dissipation | coarticulation |  |
| 29 | dissociation | coarticulation |  |
| 30 | domination | coarticulation |  |
| 31 | duration | coarticulation |  |
| 32 | emancipation | coarticulation |  |
| 33 | expectation | coarticulation |  |
| 34 | fertilization | coarticulation |  |
| 35 | flirtation | coarticulation |  |
| 36 | formalization | coarticulation |  |
| 37 | fragmentation | coarticulation |  |
| 38 | generation | coarticulation |  |
| 39 | gradation | coarticulation |  |
| 40 | graduation | coarticulation |  |
| 41 | granulation | coarticulation |  |
| 42 | harmonization | coarticulation |  |
| 43 | hesitation | coarticulation |  |
| 44 | horatian | coarticulation |  |
| 45 | improvisation | coarticulation |  |
| 46 | incarceration | coarticulation |  |
| 47 | incarnation | coarticulation |  |
| 48 | indoctrination | coarticulation |  |
| 49 | industrialization | coarticulation |  |
| 50 | infatuation | coarticulation |  |
| 51 | information | coarticulation |  |
| 52 | installation | coarticulation |  |
| 53 | instantiation | coarticulation |  |
| 54 | insubordination | coarticulation |  |
| 55 | interpenetration | coarticulation |  |
| 56 | intersection | subsection |  |
| 57 | intimation | coarticulation |  |
| 58 | invocation | coarticulation |  |
| 59 | liberalization | coarticulation |  |
| 60 | ligation | coarticulation |  |
| 61 | localization | coarticulation |  |
| 62 | masturbation | coarticulation |  |
| 63 | maturation | coarticulation |  |
| 64 | miscomputation | coarticulation |  |
| 65 | misrepresentation | coarticulation |  |
| 66 | mohel | control |  |
| 67 | navigation | coarticulation |  |
| 68 | noncooperation | coarticulation |  |
| 69 | nonlocal | bifocal |  |
| 70 | nonparticipation | coarticulation |  |
| 71 | organisation | coarticulation |  |
| 72 | ornamentation | coarticulation |  |
| 73 | overregulation | coarticulation |  |
| 74 | overstimulation | coarticulation |  |
| 75 | pollination | coarticulation |  |
| 76 | preordination | coarticulation |  |
| 77 | proliferation | coarticulation |  |
| 78 | pronunciation | coarticulation |  |
| 79 | prostration | coarticulation |  |
| 80 | reanimation | coarticulation |  |
| 81 | redial | crocodile |  |
| 82 | refutation | coarticulation |  |
| 83 | registration | coarticulation |  |
| 84 | remobilization | coarticulation |  |
| 85 | republication | coarticulation |  |
| 86 | requalification | coarticulation |  |
| 87 | reregulation | coarticulation |  |
| 88 | reservation | coarticulation |  |
| 89 | russification | coarticulation |  |
| 90 | scruple | quintuple |  |
| 91 | sedation | coarticulation |  |
| 92 | sensation | coarticulation |  |
| 93 | separation | coarticulation |  |
| 94 | situation | coarticulation |  |
| 95 | spokeswoman | newswoman |  |
| 96 | stagflation | coarticulation |  |
| 97 | transplantation | coarticulation |  |
| 98 | vibration | coarticulation |  |
| 99 | vindication | coarticulation |  |
| 100 | vowel | fowl |  |

## Result

**The sample is withdrawn and is not to be judged.** It is kept as drawn, because
what it asks is the finding.

Seven of the eight partners carrying 97% of the population are words whose stress
CMUdict marks against a sibling in the same index (`articulation`, `section`,
`tangle`, `woman`). The eighth, `tucuman`, is a province in Argentina sitting in
`words` rather than `names`. None of the eight is a claim about what a General
American listener can hear.

So 89 of the 100 rows ask whether `coarticulation` is mis-stressed, in the costume
of asking whether a schwa is droppable. The maintainer would have answered "yes,
they rhyme" 89 times and been right every time, and the rule would have scored an
error rate near 11% — a measurement of CMUdict's stress marking, not of the rule.

The rule's population net of upstream data errors is **33 words**. That is small
enough to read rather than sample, so no error rate, threshold or decision rule
applies to it. The three-branch decision rule #211 pre-registered assumed the
population was real and asks about the wrong object; it is not applied.

Recorded as [ADR-0018](../adr/0018-appending-reach-is-measured-net-of-data-errors.md).
