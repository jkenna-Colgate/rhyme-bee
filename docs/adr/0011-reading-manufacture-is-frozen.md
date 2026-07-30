# Reading manufacture is frozen; a correction lands in the data, not in a new rule

The build manufactures readings in two stages — coverage derivation
(`src/coverage.ts`, `src/affixes.ts`) composes a reading for a known word that
has none, and normalisation (`src/normalise.ts`) rewrites readings into the
accent the game claims. Both are shipped, measured and load-bearing. Neither has
ever had a stated endpoint, and that is the defect this ADR fixes.

**As of 2026-07-30 the rule set is frozen at three normalisation rules and thirty
affix rules.** No further rule is proposed, designed or landed. A pronunciation
that comes out wrong is corrected in `data/supplement.dict`, a name that reaches
the word list in `data/names.txt`, a non-word in `data/words.txt`.

The Rhyme rule is unchanged, again. ADR-0001 has never been amended by any of
this work and is not amended here. ADR-0010's admissibility test is not
loosened, tightened or retired — it still governs the rules that exist. This ADR
says only that no *new* rule will be brought to it.

## Why now, and why not on the ear

The motivating worry was that the rules were accumulating exceptions toward a
rule-per-word, and that the game was reproducing the failure of hand-written
grammars. Measured, that is false by two and a half orders of magnitude, and the
measurement is the reason this freeze is a scope decision rather than an
architectural retreat.

### The reach of the frozen set

Over the playable lexicon — every surface form in `data/cmudict.dict` that
passes the wordhood gate and is not a name — counting **words whose Rhyme Key
set changes**, which is the only change that can alter a verdict:

| | words |
|---|---|
| have a reading after the committed supplement | 51,321 |
| gain a reading from coverage derivation | **+7,433** (+14.5%) |
| have their Rhyme Key set changed by normalisation | **7,480** |
| — whose pre-normalisation key contained `AO` (the merge) | 1,874 |
| — the two appending rules | 5,606 |

Coverage derivation is thirty rules, the largest being `suffix:ly` (1,646),
`suffix:ness` (1,400), `suffix:er` (1,118) and `prefix:un` (882), the smallest
`suffix:est` (3). So roughly **fourteen thousand nine hundred word-level effects
from thirty-three rules — about 450 words per rule — against the thirty-five
hand-written entries in `data/supplement.dict`.**

Reproduce by building the index three times with `applyCoverage` and
`applyNormalisation` ablated, and diffing `rhymeKeyOf` over each word's readings.
The raw data is uncommitted (ADR-0003), so this cannot be a test in the suite.

### What the same measurement says against the rules

The reach is not free. ADR-0010's amendment already records that **6.8% of
stress promotion's key-gaining promotions override a shape CMUdict usually marks
unstressed** — `barbados`, `bimbos`, `burritos`, `clergyman`, `countryman`,
`dutiful` — and a further 37.2% land in a mixed band where CMUdict holds no
convention either way. The frozen set is high-reach and demonstrably imperfect.
Freezing it accepts that error rate rather than pretending it away, and the two
known groups inside it stay open as defects (#85, #86).

## Considered Options

**Keep going, driven by complaints.** Rejected — this is the status quo, and it
is the thing being fixed. Every rule has been individually justified and
individually measured, and there is still no state of the world in which the
work is finished. An unbounded backlog is a scope failure even when every item
on it is defensible.

**Revert the appending rules and hand-write their effect.** Rejected. It would
reintroduce the `bratwurst` and `viceroy` class the supplement was built to
heal, and replacing 14,900 word-effects by hand is thousands of supplement
lines. The rules are paid for; freezing costs nothing, reverting costs the
reach.

**Land the planned set (#69 perceptual normalisation, #78 voicing-conditioned
`-ed`/`-s`) and freeze after.** Rejected on ADR-0009's own reasoning — *don't
build the machine before you know the workload*. Roughly a week of machine has
been built and the workload has still never been measured. #69 is the largest
remaining rule and no evidence says it is needed. Landing it first is the exact
mistake that produced the backlog.

**Freeze permanently, with no reopening clause.** Rejected as overclaiming. The
evidence available to justify a permanent close is one maintainer's play, and a
maintainer who knows which words the game rejects is the most biased sampler of
them available. An ADR that claims more than its evidence gets falsified and
then stops being followed — including where it was right.

## The unfreeze clause

The freeze is **deferral backed by a stated trigger**, not a closure.

> A new reading-manufacture rule may be proposed only on evidence that **players
> other than the maintainer** are meeting a rejection class the frozen rules
> cannot reach, identified by class rather than by anecdote.

The instrument already exists: the dev feedback button files an issue with
puzzle and session context attached (#41, #43). The measurement discipline is to
press it on **every verdict that feels wrong, whether or not it gets fixed** — a
supplement line counts only corrections diligent enough to make, and the
rejections shrugged off are the ones a stranger meets.

A maintainer-only run buys the right to stop working on this now. It is not
evidence that the tail is empty, and this ADR does not claim it is.

## Consequences

- **Closed as won't-do:** #69 (perceptual normalisation), #78 (voicing-conditioned
  `-ed`/`-s`), #56 (Tier 1 coverage by affixation), #71 (the `-ule` family).
- **Still open, and not exceptions to this freeze:** #85 and #86 are defects in
  frozen code, and #75 pins a Seed to a real dictionary reading deterministically
  — a build whose output can shift between rebuilds cannot be approved the night
  before, so determinism is now an approval guarantee, not a curation nicety.
- **A correction is global or it does not happen.** Per-puzzle answer-set
  overlays are barred. A supplement entry is permanent infrastructure (ADR-0009)
  and applies to every Puzzle that word ever appears in; an overlay is dead the
  day its Puzzle ships. Global-only is what makes the maintainer's nightly
  workload decay instead of recur.
- **The correction sites are three, and they are named**: `data/supplement.dict`
  (readings and stress), `data/names.txt` (proper nouns reaching the word list),
  `data/words.txt` (junk with wordhood). A header in the supplement points at
  this ADR, because that file is where the temptation will actually be felt.
- **Every nightly fix triggers a full index rebuild**, which can shift the answer
  set of a Puzzle already approved. This is the accepted price of global
  corrections; approving one day ahead is what makes it visible.
- **`RULES` and the affix inventory are closed sets.** Adding to either is a
  change to this ADR, not a change to a list.

## Amendment, 2026-07-30 — the correction sites are four, and one of them is new

Naming `data/names.txt` and `data/words.txt` as correction sites was a mistake of
fact: **both are gitignored**, regenerable from pinned upstream sources
(ADR-0003), so a correction made there exists on one machine and no other. It
survives `npm run build:index` and nothing else — not a fresh clone, not a
second agent's clone, not review. That is the precise problem ADR-0009 wrote the
supplement to solve, and the supplement solves it only for *readings*: it adds
and overrides, and has no way to withdraw wordhood.

Attempting #90 against those two files surfaced this immediately, along with the
reason the correction is needed at all: the wordhood gate tests `words` **before**
`names`, so a word in both upstream lists is served to the player as an ordinary
Answer. `heinz`, `marx`, `rhodes`, `troy` and `kate` are all in both today —
`kate` being CONTEXT.md's own illustration of a Proper Noun, and `ate` the
Tutorial's Seed.

The fourth site is **`data/demotions.txt`** (`src/demotions.ts`, stage 0 of the
build): one hand-read word per line with the rejection reason it earns,
`proper-noun` or `not-a-known-word`. Committed, so the correction outlives the
data it corrects.

**The reordering this looks like was considered and rejected on measurement.**
Letting `names.txt` supersede `words.txt` in the gate is a one-line change and
would fix every leaked name at once. It also demotes **9,133 words that are in
both lists** — 6,565 of which have readings and reach adjudication, 2,476 of them
Answer-tier — because the names source is SSA baby names, which is every string
given to five babies in a year: `add`, `air`, `apple`, `autumn`, `child`,
`faith`, `heart`, `hero`, `joy`, `you`, `young`. Restricting it to names absent
from the prevalence norms still sweeps 3,855 words, unreviewed, many of them
legitimate Bonus Words. The gate is words-first for a reason; only a curated list
may override it.

This amendment does not loosen the freeze. A demotion is data, it is global
(ADR-0011's own rule), and it manufactures no reading — the closed sets in
`src/normalise.ts` and `src/affixes.ts` are untouched. The demotion list is
**bounded by measurement**, not by taste: its entries are the names the #89
measurement surfaced and the one #51 reported. Widening it means measuring
again, and "make the names filter correct" remains barred as the unbounded
backlog it is.
