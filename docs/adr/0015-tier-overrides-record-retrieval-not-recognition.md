# Tier overrides record retrieval, which prevalence cannot measure

A committed layer, `data/tier-overrides.csv`, lets the puzzles editor set any word's **Tier** by name, overriding the measured prevalence the split is otherwise drawn from ([ADR-0003](./0003-word-prevalence-not-corpus-frequency.md)). It is merged over the parsed prevalence map at index-build time, before `RhymeIndex#tier` reads it, so no adjudication code learns that overrides exist. Like the pronunciation supplement it is **permanent infrastructure, not a patch** ([ADR-0009](./0009-pronunciation-supplement-is-the-permanent-override-layer.md)): any prevalence source will get some words wrong for this game's purposes, because the game needs a quantity no such source measures.

This is the mechanism ADR-0003 already called for — *"prevalence sorts the tiers automatically, but a light human pass over each curated puzzle catches the handful the data gets wrong"* — built at last, and narrowed. ADR-0003 gave that human pass two jobs: catching individual errors, and tuning the threshold. This ADR keeps the first and severs the second (see **The circularity this must never become**).

## Why prevalence cannot decide this

Word prevalence measures **recognition**: the proportion of surveyed people who report knowing a string when shown it. The game needs **retrieval**: whether a player, given a Seed Word, will *produce* the word from nothing. For most vocabulary the two track each other closely enough that the difference never surfaces. For one class they come apart maximally — **transparent prefix compounds**, where a reader confronted with `counter·thrust` can obviously decode it and will tick the box, and a player hunting rhymes for `bust` will never think of it.

The class is large. **324 of the 1,545 prefix-derived Answers on the shipped schedule score below 1.0** — `unsex` (0.009), `postganglionic` (0.018), `readmit` (0.030), `antigun` (0.045), `ungird` (0.054), `interleave` (0.078), `resit` (0.095), `midmost` (0.096), `outtalk` (0.125). It is also machine-visible: every prefix involved is already in `PREFIXES` (`src/affixes.ts:112`), and `Derivation.isDerived` already detects the class, so a future worklist can sort by it.

Crucially, the failure is a **ranking inversion, not a miscalibrated line**. On the Seed Word `bust`:

| word | prevalence | Pknown |
|---|---|---|
| `misadjust` | **0.8149** | 79.5% |
| `readjust` | **0.7638** | 78.0% |

The data ranks `misadjust` *above* `readjust`, and no threshold anywhere on the scale reorders two words. A player will produce `readjust` readily and `misadjust` essentially never. A per-word lever is the only instrument that can express this, because the defect is in the ordering rather than in where the ordering is cut.

None of this is a defect in Brysbaert et al. It is a proxy failing at its edge, used for a purpose it was not collected for.

## Why not move the threshold instead

The threshold (`KNOWNNESS_THRESHOLD`, today `0.0`) is the obvious lever and is the **higher-variance instrument, not the safer one**. It is also not arbitrary: `0.0` means "an Answer is a word about half of surveyed people know". Measured against the 10,578 unique Answers the shipped schedule serves:

| threshold | ≈ Pknown | Answers demoted |
|---|---|---|
| 0.0 (today) | 50% | — |
| 0.25 | 60% | 241 |
| 0.5 | 69% | 575 |
| 1.0 | 84% | 1,634 |
| 1.25 | 90% | 2,339 |

The collateral at 1.0 is the whole point: `assuage` (0.983), `tryst` (0.983), `bombast` (0.983), `frenetic` (0.981), `banality` (0.980), `engender` (0.980), `linchpin` (0.991), `tome` (0.989), `centenarian` (0.994), `orthography` (0.987) — every one demoted. That is precisely the `defenestrate` class ADR-0003 chose prevalence *for* and [ADR-0006](./0006-scoring-is-length-dominant-with-a-flat-rare-bonus.md) built the rare bonus *around*. They cluster in a dense band just under 1.0, which is why a threshold move there is destructive out of proportion to its size.

**The threshold stays at 0.0, or nudges no further than 0.5. It is set as a policy sentence against the Pknown column above, and nothing else.**

## Why the layer carries numbers rather than verdicts

The layer could have stored a Tier verdict directly, with a separate field for rarity. It stores a **prevalence value** instead, and each verdict compiles to one of three constants.

The alternative was seriously considered and is the more theoretically honest design, because a hand-set number in a field documented as measured prevalence is a fabrication. It was rejected on three grounds. The field was never truth to begin with — it is an approximation of recall, which is the whole argument above. The layer is separable, so the provenance of any doctored value is the file itself, and a rebuild without it is always possible. And keeping one type means `#tier`, `isRare`, `scoreEntry` and `measureAnswers` are all untouched: the override cannot introduce a second tiering path that drifts from the first.

The cost of that choice is that a verdict's meaning depends on where two knobs sit. It is paid with a **build-time guard**: `npm run build:index` asserts that each sentinel still yields its intended Tier and rarity under the current `ScoringConfig`, and fails if a knob has moved underneath it. The risk is not eliminated, it is made loud.

## The circularity this must never become

The `measured` column records what prevalence said at the moment of each judgement. It is an **audit trail, not a training set**.

It is tempting, and wrong, to plot the prevalence of demoted words and slide the threshold to fit. Tuning a threshold to agree with one's own labels returns one's own opinion wearing a number, and would destroy the independent standing that makes the threshold worth having. The threshold is chosen against the Pknown table above, which requires no labels at all. **Overrides never calibrate the threshold.**

## Consequences

- **The file is `data/tier-overrides.csv`**, columns `word,verdict,measured,decided,note`. It is machine-written by the Editor's Pass and never hand-edited. `measured` is left empty when the word had no prevalence row, which separates *lemmatiser gaps* (`bolder`, `bussed` — a coverage problem) from *genuine disagreements with the data* (`counterthrust` at 1.2119 — this ADR's problem). Those are different populations with different remedies and the file must keep them distinguishable.

- **Four verdicts**, compiling to prevalence values:

  | verdict | value | effect |
  |---|---|---|
  | `bonus` | -3.0 | below the observed minimum (-2.11); a Bonus Word |
  | `answer-rare` | 0.6 | an Answer, and rare (73% known) — earns `rareBonus` and counts toward Difficulty |
  | `answer-common` | +3.0 | above the observed maximum (+2.58); an ordinary Answer |
  | `none` | — | no patch applied; prevalence governs |

  `none` exists because withdrawal and reversal are different acts. "Undoing" a demotion with `answer-common` would pin the word to +3.0, silently stripping the rare bonus from a word that measured below 0.7 — the editor would believe they had reverted and would be wrong.

- **The sentinel values are not free parameters.** `bonus` and `answer-common` sit outside the observed data range deliberately. `0.6` is boxed between the Answer threshold below and `rareKnownnessCutoff` (0.7) above, so it has no wide margin; it clears a threshold nudge to 0.5 and is covered by the build guard on the other side.

- **The file is append-only, last-wins.** A word may appear many times; the build takes the last row. Appending cannot corrupt what is already written, whereas rewriting a row opens a crash window over a file that can never be regenerated. History is preserved and the reversal record is itself evidence. The readout flags any word carrying more than one row, so a reversal is never invisible.

- **`data/demotions.txt` is untouched and stays separate.** It removes **wordhood** — a demoted word is *rejected*, with a named reason the player sees ([ADR-0011](./0011-reading-manufacture-is-frozen.md) fixes it as the first build stage, so every later stage reads a corrected word list). No prevalence value can express that: setting `kate` to -3.0 leaves its wordhood intact and returns it as an accepted, celebrated Bonus Word. The two files also have opposite growth policies — `demotions.txt` is bounded by design and argues for its own bounds in its header; this one grows with every Editor's Pass.

- **An override is global across a word's Rhyme Keys**, because knownness is a property of a word rather than of a family. This falls out of patching prevalence and is the intended reading: a word a player cannot retrieve cannot be retrieved on either of its keys.

- **Schedule figures will move, and band membership stays advisory.** Re-tiering changes a day's answer count, maximum Score and Difficulty. `checkDayDrift` decides `drifted` purely by band membership (`src/schedule.ts:443`), and the recorded figures are displayed rather than compared, so there is nothing to "re-record" to silence it. The editor warns and never blocks: [ADR-0012](./0012-the-schedule-is-a-reviewed-artifact.md) binds the calendar, not what a Puzzle contains, and a tool that refused the editor's judgement would invert this ADR. The remedy for a day genuinely spoiled is to re-deal that one day's Seed.

- **Blast radius is one day.** The shipped schedule uses 260 distinct Rhyme Keys across 260 days with no repeats, so an override touches at most one scheduled day per Rhyme Key of the word. Rechecking the affected days costs ~90 ms each; rechecking all 260 costs 23 s and stays a deliberate pre-ship action.

- **Authoring is the Editor's Pass**, and this layer is what moves it to a browser: a Tier judgement is picking from a displayed list, which is the task a CLI is worst at, and this ADR makes that act routine. See [ADR-0016](./0016-the-editors-pass-is-a-browser-tool.md).
