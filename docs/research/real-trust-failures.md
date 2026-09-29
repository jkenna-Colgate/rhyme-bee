# What kinds of Trust failure have real players actually hit?

Research for [What kinds of Trust failure have real players actually hit?](https://github.com/jkenna-Colgate/rhyme-bee/issues/222),
on the map [Wayfinder: run the game unattended at a Playability Bar](https://github.com/jkenna-Colgate/rhyme-bee/issues/218).
Local evidence only: what is on disk and on the tracker as of 2026-09-29.

## The answer in brief

- **Real players have raised 49 Trust failures** (false rejections): 42 distinct
  Candidates in the Candidate Queue and 7 more in `feedback` issues. **One False
  Accept** came from a player (`troy`). Every other False Accept on record was
  found by a human reading output or by a measurement taken for another reason.
- **Missing reading is the dominant cause: 28 of 49 (57%)**, and 20 of those 28
  are still open. Normalisation (accent and inaudible contrasts) is second at
  10 of 49, and all 10 are fixed. Wordhood 5, wrong or incomplete reading 5,
  genuine disagreement with the Rhyme rule 1. The name filter and Tier caused
  no false rejection.
- **Since the deploy, the picture is one-dimensional.** All 16 distinct words
  Appealed after 2026-08-10 were rejected as `not-a-known-word`, none as
  `does-not-rhyme`. 12 of the 16 are in the word list and simply have no
  pronunciation; the other 4 lack wordhood. So every player who Appealed was told
  "not a word we know" and, 12 times out of 16, that message was false.
- **False Accepts are invisible to the passive channel.** An Appeal can only be
  raised against a rejection, so a wrong acceptance produces no signal. An
  unattended loop must look for False Accepts itself.

## Sources

| Source | What it holds | Where |
| --- | --- | --- |
| Candidate Queue | 45 Appeal records, 43 distinct (word, Seed) pairs | `data/supplement-candidates.jsonl` in the main checkout. Git-ignored (`.gitignore:25`), so it is not on any branch. File last modified 2026-08-14. |
| Declines | Header only, **zero rulings** | `data/declines.txt` |
| Deferred readings | 29 readings the Editor's Pass add path asked an agent for and did not get | `data/deferred-readings.jsonl` |
| Demotions | 20 `proper-noun`, 7 `not-a-known-word` | `data/demotions.txt` |
| Pronunciation supplement | Adds and corrections, each with a note giving its origin | `data/supplement.dict` |
| Tier overrides | 122 Retrieval verdicts: 113 `bonus`, 8 `answer-*`, 1 `none` | `data/tier-overrides.csv` |
| `feedback` issues | 17 issues, 8 of them about a word verdict | `gh issue list --label feedback --state all` |
| Closed engine issues | The False Accept fixes: names, `hurricane`, the `-os` plurals, the syllabic-consonant rule | Linked below |
| Built Rhyme Index | Used to re-check each case against today's engine | `dist-data/index-b2d5ee6d53dbcdba.json` in the main checkout, built 2026-09-20 |
| Raw CMUdict | Used to tell "no reading upstream" apart from "reading lost in the build" | `data/cmudict.dict` in the main checkout |

**Method.** For every case I looked up the word's current wordhood, name-list
membership, readings and Rhyme Keys in the built index, and I recomputed the
Rhyme Key (last stressed vowel to the end) against the Seed Word. A case counts
as *resolved* if today's index accepts it. The cause is the first gate the
word failed when it was raised: wordhood, then reading presence, then the
reading itself (`src/rhymeIndex.ts:382-409`).

**Not covered.** The R2 bucket that deployed Appeals land in was not read, so
Appeals made after the last `npm run appeals:pull` are missing here. The newest
record in the local queue is dated 2026-08-14. Running `npm run appeals:pull`
and repeating the count would close that gap.

## Trust failures (false rejections): 49 cases

### By cause

| Cause | Cases | Resolved | Open | Share |
| --- | --: | --: | --: | --: |
| Missing reading (word has wordhood, no pronunciation) | 28 | 8 | 20 | 57% |
| Accent or normalisation (a contrast General American cannot hear) | 10 | 10 | 0 | 20% |
| Wordhood (word not in the word list) | 5 | 0 | 5 | 10% |
| Wrong or incomplete reading (a reading exists, but the stress is wrong or a real variant is missing) | 5 | 2 | 3 | 10% |
| Genuine disagreement with the Rhyme rule | 1 | n/a | 1 | 2% |
| Name filter | 0 | | | |
| Tier | 0 (as a rejection; see below) | | | |
| **Total** | **49** | **20** | **29** | |

Not counted: `overrule` against `buhl`, rejected as `already-submitted`, is an
Appeal against a correct verdict. `eight` and `weight` in
[ate puzzle incorrectly rejects eight and weight as non-rhymes](https://github.com/jkenna-Colgate/rhyme-bee/issues/44)
was the feedback button's own end-to-end test, not a player report.

### Missing reading: 28 cases, 20 open

The word is in the word list and CMUdict has no line for it, so the engine has
nothing to rhyme-test. It then rejects the word as `not-a-known-word`
(`src/rhymeIndex.ts:391-400`), which the player sees as "not a word we know"
(`src/verdict.ts:42`). The code comment admits this reuses the closest reason
from a closed set. To a player it reads as the game claiming `awl` is not a word.

| Subkind | Cases | Examples (open ones in **bold**) |
| --- | --: | --- |
| Base word missing from CMUdict | 17 | **`awl`, `trawl`, `pawl`** vs `wall`; **`drat`, `frat`** vs `cat`; **`epigraph`** vs `calf`; **`parallelogram`** vs `bam`; `globule`, `pustule`, `ampoule`, `ferule` vs `buhl` (fixed) |
| Regular `-ed` inflection | 4 | **`gawked`, `caulked`** vs `shellshocked`; **`pepped`** vs `slept`; **`teared`** vs `beard` |
| Prefix or compound | 7 | **`toadstool`, `kickball`, `overemploy`**; `undocked`, `airburst`, `overjoy`, `macromolecule` (fixed) |

What fixed the resolved ones:

- a hand-authored supplement sweep, [Judge the -ule family into the pronunciation supplement (38 words, target key UW L)](https://github.com/jkenna-Colgate/rhyme-bee/issues/71), for `globule`, `pustule`, `ampoule`, `ferule` and `macromolecule`;
- prefix derivation, [Coverage seam + prefix derivation + derived-words report](https://github.com/jkenna-Colgate/rhyme-bee/issues/76), for `undocked`;
- single supplement adds after feedback: `airburst` from [Inconsistent word validation: cloudburst vs airburst](https://github.com/jkenna-Colgate/rhyme-bee/issues/48) and `overjoy` from [Add overjoy to word list](https://github.com/jkenna-Colgate/rhyme-bee/issues/52).

The `-ed` gap is known. [Suffix derivation: voicing-conditioned -ed and -s](https://github.com/jkenna-Colgate/rhyme-bee/issues/78)
was closed wontfix, and reading manufacture is frozen
([ADR-0011](../adr/0011-reading-manufacture-is-frozen.md), restated at `data/supplement.dict:15-22`).
So an inflection whose lemma CMUdict does hold (`gawk`, `caulk`, `pep`) is still
rejected.

**The gap is large.** In the built index, 21,707 words have both wordhood and a
prevalence row but no reading. 13,888 of those sit at or above the shipped Answer
threshold (`knownnessThreshold` 0, in the index `config`), and 363 are in the
top band of the prevalence scale, which holds 15,908 words in total. Examples
from that top band: `afterbirth`, `airbrush`, `backspace`, `bamboozled`,
`beanbag`, `beanie`. Most of these words will never rhyme with any Seed Word,
but the figure bounds how much of this class is still waiting to be found.

The Editor's Pass has been working through the same class ahead of players. It
added **203** readings to the supplement from pasted third-party rhyme lists
(`data/supplement.dict:229-434`), for example `hairpin`, `clothespin`,
`gherkin`, `mudroom`, `homeroom` and `schlepped`. No player Appealed any of them
first.

### Accent or normalisation: 10 cases, all fixed

These are all from the first two days of play (2026-07-27 and 2026-07-28). They
are the evidence behind
[Perceptual normalisation: stop adjudicating contrasts a General American listener cannot hear](https://github.com/jkenna-Colgate/rhyme-bee/issues/69),
whose "27 entries across 4 Seed Words" is exactly the pre-deploy part of today's
queue.

| Mechanism | Cases | Fixed by |
| --- | --- | --- |
| Cot-caught merger (`AO` vs `AA`) | `talked`, `walked`, `balked`, `stalked`, `hawked` vs `docked` | [Normalisation seam + merged General American vowel merge](https://github.com/jkenna-Colgate/rhyme-bee/issues/72) |
| Stress digit on a full vowel | `module`, `schedule` vs `buhl` | [Stress promotion: unstressed full vowel in a closed final syllable](https://github.com/jkenna-Colgate/rhyme-bee/issues/73) |
| Optional schwa before a syllabic `l` | `renewal`, `crewel`, `duel` vs `buhl` | [Optional syllabic-consonant schwa variant](https://github.com/jkenna-Colgate/rhyme-bee/issues/74) |

**No Appeal after the deploy has been a `does-not-rhyme` verdict** (all 16 are
`not-a-known-word`). So nothing on disk suggests this class is still producing
new player-visible failures, but players have hit a much smaller sample of Seed
Words since then.

### Wordhood: 5 cases, all open

`unspool`, `multitool`, `relocked` (vs `buhl` and `shellshocked`), `albuterol`
(vs `wall`), and `underemploy` from
[Accept viceroy, underemploy, overemploy as valid words](https://github.com/jkenna-Colgate/rhyme-bee/issues/53).
Three are transparent prefix derivatives (`un-`, `re-`, `under-`), one is a
compound and one is a drug name. `albuterol` and `underemploy` already have a
reading that rhymes (`underemploy` straight from CMUdict), so wordhood is the
only thing blocking them.

`underemploy` and `overemploy` were triaged in #53 as "tracked on #54". Both are
still rejected today, so those two Trust failures were dropped without anyone
deciding to drop them.

### Wrong or incomplete reading: 5 cases, 3 open

- **Wrong upstream stress, fixed.** `bratwurst` vs `burst`
  ([Bratwurst incorrectly rejected as non-rhyming](https://github.com/jkenna-Colgate/rhyme-bee/issues/46))
  and `viceroy` vs `oy` (#53). CMUdict marks the final syllable `0`. The AI
  triage on both issues diagnosed the stress correctly but closed them as "not an
  engine bug". The maintainer then corrected both in the supplement
  (`data/supplement.dict:34-44`).
- **Inconsistent upstream stress, open.**
  [A bunch of words similar to lunatic seem like they are missing.](https://github.com/jkenna-Colgate/rhyme-bee/issues/212)
  on `trick`. CMUdict gives the final `-ic` secondary stress in `lunatic`,
  `politic`, `picnic` and one reading of `arithmetic` (`IH2 K`), so they rhyme
  on `IH K`. It leaves the syllable unstressed in `heretic`, `rhetoric`,
  `catholic`, `limerick` and `critic` (`IH0 K`), so they do not. The player met
  the first group being accepted and expected the second. Which way to fix this
  is itself a question about the Rhyme rule (a light-verse rhyme on an
  unstressed `-ic`). The issue has no comment yet.
- **Missing variant, open.** `granule` vs `buhl`: CMUdict has only `AH0 L`, but
  "GRAN-yool" is a real General American variant.
- **Near-schwa not caught by the rule, open.** `gruel` vs `buhl`: CMUdict writes
  `UW1 IH0 L`. The syllabic-consonant rule only drops an `AH0`, so `gruel` stays
  out while `duel` and `crewel` got in.

### Genuine disagreement with the Rhyme rule: 1 case

`ashram` vs `bam`. The final syllable is unstressed, so under the rule it cannot
rhyme on `/æm/`, and the rejection is correct. There is a twist, recorded under
False Accepts below.

### Tier

No Appeal was about Tier, because Appeals only contest rejections. Tier did come
up twice as a secondary grievance. In #48 and #52 the fix left `airburst` and
`overjoy` as Bonus Words, since supplement adds carry no prevalence, and the
triage comments say so
([ADR-0009](../adr/0009-pronunciation-supplement-is-the-permanent-override-layer.md)).
Separately, the Editor's Pass has recorded 122 Retrieval verdicts in
`data/tier-overrides.csv`, 113 of them moving a word from Answer to Bonus Word
(`CONTEXT.md`, **Retrieval**). No player asked for any of these.

## False Accepts: what is on record

| Cause | Cases | How it was found |
| --- | --- | --- |
| Name filter (a name with wordhood served as an Answer) | 20 demoted as `proper-noun`, `kate` and `troy` among them | `troy`: a player, in [Proper noun validation not catching 'troy](https://github.com/jkenna-Colgate/rhyme-bee/issues/51). The other 18: the Seed-pool measurement in [Names leaking the filter keep 54 shadow keys in the Seed pool](https://github.com/jkenna-Colgate/rhyme-bee/issues/89), fixed by [Proper nouns hold wordhood and are accepted as Answers](https://github.com/jkenna-Colgate/rhyme-bee/issues/90). `nepal`: the Editor's Pass. |
| Wordhood junk (abbreviation, misspelling, Latin) | 7 (`lbs`, `oct`, `preceeding`, ...) | The same #89 measurement |
| Wrong upstream reading | 14: `hurricane` and 13 `-os` plurals | `hurricane`: a human reading the schedule review, in [hurricane carries a spurious final Z and rhymes with plurals](https://github.com/jkenna-Colgate/rhyme-bee/issues/96). The plurals: a reach measurement of stress promotion, in [Correct the -os plurals CMUdict transcribes with S](https://github.com/jkenna-Colgate/rhyme-bee/issues/85). |
| Normalisation over-reach | 10 reported pairs plus neighbours (`worn`/`foreign`, `curl`/`liberal`, `male`/`betrayal`, ...) | [The syllabic-consonant schwa drop accepts words that do not rhyme](https://github.com/jkenna-Colgate/rhyme-bee/issues/209). The fix left `spiritual`, `contextual`, `textual` and `unusual` accepted for `cool`, as a documented residue. |
| Upstream stress errors reaching through normalisation | Most of the 1,038 words the syllabic rule gives a new partner, still open | [ADR-0018](../adr/0018-appending-reach-is-measured-net-of-data-errors.md) and [Stop the syllabic consonant manufacturing a coda that licenses stress promotion](https://github.com/jkenna-Colgate/rhyme-bee/issues/86) |

Three more turned up while checking cases for this research:

- **`ashram` is accepted for `calm` and `bomb`.** CMUdict reads it
  `AE1 SH R AA0 M`, stress promotion lifts the `AA0`, and the promoted reading
  sits on `AA M`. Nobody says "ash-RAHM" in a way that rhymes with `calm`, so
  this is the rule's closed-final-syllable promotion acting on an unstressed
  syllable that CMUdict marked with a full vowel. It is the same kind of error as
  the `-os` plurals.
- **An editor's Tier verdict put a name back in play.** `neptune` is in the names
  data and also has wordhood. The Editor's Pass set it to `answer-common`
  (`data/tier-overrides.csv`, 2026-09-02), although it had already demoted
  `nepal` as a Proper Noun (2026-08-14). Human rulings on names are not
  consistent either.
- **Three supplement readings are malformed ARPAbet**: `effaced` and `absume`
  have a vowel `AH` with no stress digit, `absume` also has a consonant `B0`
  carrying one, and `kumkum` has the fused token `KAH0` (`data/supplement.dict`,
  Editor's Pass adds). All three still reach their Rhyme Key, because the last
  stressed vowel is well formed. But they show that the add path's verification
  checks the key, not the reading as a whole.

**Only one False Accept ever arrived by a player channel, and it arrived as free
text.** The AI triage then closed it as wontfix ("`troy` is a legitimate common
noun: a troy ounce"). It was only fixed later, when the #89 measurement turned
up the wider leak and `troy` was demoted with the rest (`data/demotions.txt`,
"`#51, reported from play`").

## What an unattended loop would have to handle

Ranked by weight in the evidence:

1. **Missing reading.** This is 57% of the player cases, 20 still open, and
   the only cause seen since the deploy apart from wordhood. The loop needs a
   source of readings for known words. The Editor's Pass add path already tries
   agent-authored readings and checks them against the target Rhyme Key: 29 of
   those are held in `data/deferred-readings.jsonl`. 24 failed that check and 5
   hit an unavailable agent. The check did its job. At least three failures are
   malformed ARPAbet (`PAE1` for `pangolin`, `HH2` for `hyaline`, `HH1` for
   `hircine`). Several are plausible readings of words that do not rhyme on the
   target key under the rule (`porcine`, `pidgin`, `tarpaulin`, `smidgeon`,
   `bombe`, `degum`). That second group shows the pasted third-party lists are
   looser than the Rhyme rule.
2. **The message on a missing reading.** Separate from fixing the reading, the
   player is told "not a word we know" about real words. This can be detected
   mechanically (wordhood present, reading absent, `src/rhymeIndex.ts:397`),
   and nothing detects it today.
3. **Wordhood for transparent derivatives** (`un-`, `re-`, `under-`, compounds).
   Five cases, all open.
4. **Wrong or inconsistent upstream stress.** Five player cases, plus the False
   Accepts from the same source (the `-os` plurals, `ashram`, most of the
   ADR-0018 population). Fixing these takes a phonetic judgement about which
   syllable is stressed. The two that were fixed needed a human to overrule an
   AI triage that had said the verdict was right.
5. **An active search for False Accepts.** Names with wordhood, junk with
   wordhood, and bad readings pulled in by normalisation. The passive channel
   (Appeals) cannot see any of them.

Two classes the loop does **not** need to generate fixes for. Normalisation has
had no new player case since its three rules shipped, and reading manufacture is
frozen under ADR-0011, so the loop only needs to avoid regressing it (the
committed guardrail set). Genuine disagreement with the Rhyme rule came up once,
and the right answer there is a Decline, not a change.

## Caught by a human, with no automated signal that would have caught it

- **Every False Accept.** `troy` came through free text. The names and junk came
  from a measurement taken for a different question (#89). `hurricane` came
  from a human reading the schedule review. The syllabic-consonant pairs came
  from human reading (#209). The `ashram` and `neptune` cases above came from
  this read-through. An Appeal cannot fire on an acceptance.
- **The `-ic` inconsistency on `trick` (#212).** It arrived as a sentence of
  prose, not as Appeals on `heretic` or `rhetoric`. A player who never submits a
  word leaves no Candidate behind.
- **Wrong-stress corrections (`viceroy`, `bratwurst`).** The Appeal was an
  automated signal, but the automated triage ruled the rejection correct. It
  took a human to decide the upstream stress was wrong.
- **The 203 Editor's Pass adds.** The join against a third-party list is
  mechanical. Deciding which residue words deserve a reading was a human's
  call, and the deferred-readings file shows those lists include non-rhymes.
- **Not caught by anyone yet:** the false "not a word we know" message on 12 of
  the 16 post-deploy Appeals, and the dropped `underemploy` and `overemploy`
  from #53.

## Caveats

- The sample is small and skewed. The 43 Candidates come from 9 Seed Words,
  and the busiest Seed alone (`buhl`, 17 Candidates) is a word that
  [Hold Seed Words to a knownness floor](https://github.com/jkenna-Colgate/rhyme-bee/issues/59)
  later judged unfit to be a Seed at all.
- The queue does not record which capture path a Candidate came through. The
  pre- and post-deploy split here uses dates, taking the deploy as live by
  2026-08-10.
- `data/declines.txt` holds no rulings, so no Candidate has ever been formally
  judged "the engine was right". The one genuine-disagreement case (`ashram`)
  is my own classification.
- Prevalence figures are reported only in aggregate. The header of
  `data/tier-overrides.csv` explains why: the raw norms stay out of any public
  repository.
