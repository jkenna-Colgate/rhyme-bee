# Answers and Bonus Words are split by word prevalence, not corpus frequency

A rhyming word is counted as an **Answer** if a reasonable player could be expected to know it, and treated as a **Bonus Word** — accepted and celebrated, but uncounted — if almost nobody knows it. That line is drawn using psycholinguistic **word prevalence** data rather than corpus frequency.

## Why not frequency

Frequency is the obvious lever and it fails on precisely the words that matter most to this game. `defenestrate` is genuinely rare in print — rarer than many words that clearly belong in the Bonus tier — because it is famous *as a fun rare word*, not because it gets used. Any frequency cutoff that keeps `defenestrate` drags in a pile of genuinely unknown words; any cutoff that excludes `objurgate` excludes `defenestrate` too. Frequency is simply the wrong axis for the quantity being measured.

Word prevalence measures the proportion of people who report *knowing* a word — the exact quantity. Brysbaert, Mandera, McCormick & Keuleers (2019), *Behavior Research Methods*: 61,858 English lemmas, 220,000+ participants, American spelling. Data at https://osf.io/5fk8d/.

## Consequences

- **Verify before building on it.** Two things are unconfirmed: (a) the licence — academic norms use is not a commercial licence, and this matters if the game earns money; (b) that `defenestrate` actually scores high and `objurgate` low. Both are cheap checks and both are load-bearing.
- **The dataset is lemmas** — 61,858 against CMUdict's 134,000 entries. `gate` is present, `gates` is not. Lemmatisation before lookup is mandatory; without it, "absent from the prevalence data" would misfile every inflected form of every common word as an obscure Bonus Word.
- Prevalence sorts the tiers automatically, but a light human pass over each curated puzzle catches the handful the data gets wrong.
- Proper nouns are excluded entirely rather than tiered — see CONTEXT.md. CMUdict was built for speech recognition on news audio and is full of surnames; without a second word list, a player typing `Kate` would earn a rare-word bonus.

## Resolution (2026-07-22)

The two unconfirmed things from the Consequences above have now been checked
against the real dataset (`data/prevalence.csv`, 61,855 lemmas).

**Licence.** The prevalence norms are Brysbaert, Mandera, McCormick & Keuleers
(2019), published as academic norms at https://osf.io/5fk8d/. Academic and hobby
use is fine, which is all this project needs today. The **commercial** licence is
still unconfirmed and is **deliberately deferred** until — if ever — the game
moves toward earning money; the authors are reachable at that point. CMUdict is
BSD-2-Clause. The common-word and names lists are pinned in `data/sources.json`.
This is recorded, not resolved: revisit before any commercial launch.

**The axis is validated; the default threshold is not.** Prevalence separates the
two probe words in the right order, with a clear gap:

| word | prevalence | percentile | tier the design wants |
|---|---|---|---|
| `defenestrate` | **+0.25** | p21 | Answer — rare but known |
| `objurgate` | **−0.43** | p9 | Bonus — genuinely obscure |

So the core claim of this ADR holds: prevalence ranks the famous-rare word above
the truly-obscure one, which no frequency cutoff does. **But it does not hold at
the current default threshold of `1.0`.** On this dataset the scale runs from −2.11
to +2.58 with a median of **1.26**, so a cutoff of 1.0 marks the top ~58% of
lemmas as Answers and drops *both* probe words into Bonus — `defenestrate`
included. The index as currently built (threshold 1.0) therefore gets the flagship
example wrong.

**Decision: the default `KNOWNNESS_THRESHOLD` of 1.0 is a placeholder and is too
high. It should sit between the two probe words — around 0.0** — which makes
`defenestrate` an Answer (p21) while `objurgate` stays a Bonus Word (p9), and
lines up with the design's generous intent of celebrating rare-but-known words as
full Answers. The exact value is still to be tuned by the light human pass over
real curated puzzles that this ADR already calls for; the probe's job was only to
pin it into the right ballpark, and it has. `KNOWNNESS_THRESHOLD` stays
configuration, and the index must be rebuilt when it changes.

**Fallback if the data becomes unusable (e.g. a commercial licence is refused).**
The tier split is not a single point of failure. Because the shippable library is
only ~290 puzzles (ADR-0004), the primary fallback is to **tier by hand at
curation time** — the per-puzzle human pass already exists in the design, and
labelling each Answer/Bonus for 290 puzzles is tractable without any dataset. A
cruder automated fallback is corpus frequency plus a small hand-maintained
allow-list of famous-rare words; this is the approach this ADR rejects for the
general case, but with a human allow-list carrying the `defenestrate`-shaped
exceptions it degrades acceptably.
