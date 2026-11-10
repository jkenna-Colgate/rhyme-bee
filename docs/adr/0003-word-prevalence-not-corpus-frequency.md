# Answers and Bonus Words are split by word prevalence, not corpus frequency

**Status:** amended 2026-11-10. The test is Retrieval: an Answer is a word a player hunting rhymes would produce, and prevalence is the proxy it is measured by. The Answer line is 1.00, placed from the maintainer's marks in the Tier sitting (#310), and the anchor word is `docility` (1.03, for `facility`). Prevalence stays the axis: held out, it called the marks better than frequency or the two combined. `defenestrate` (0.25) is a Bonus Word.

A rhyming word is counted as an **Answer** if a reasonable player could be expected to know it, and treated as a **Bonus Word** — accepted and celebrated, but uncounted — if almost nobody knows it. That line is drawn using psycholinguistic **word prevalence** data rather than corpus frequency.

## Why not frequency

Frequency is the obvious lever and it fails on precisely the words that matter most to this game. `defenestrate` is genuinely rare in print — rarer than many words that clearly belong in the Bonus tier — because it is famous *as a fun rare word*, not because it gets used. Any frequency cutoff that keeps `defenestrate` drags in a pile of genuinely unknown words; any cutoff that excludes `objurgate` excludes `defenestrate` too. Frequency is simply the wrong axis for the quantity being measured.

Word prevalence measures the proportion of people who report *knowing* a word — the exact quantity. Brysbaert, Mandera, McCormick & Keuleers (2019), *Behavior Research Methods*: 61,858 English lemmas, 220,000+ participants, American spelling. Data at https://osf.io/5fk8d/.

## Consequences

- **Verify before building on it.** Two things are unconfirmed: (a) the licence — academic norms use is not a commercial licence, and this matters if the game earns money; (b) that `defenestrate` actually scores high and `objurgate` low. Both are cheap checks and both are load-bearing.
- **The dataset is lemmas** — 61,858 against CMUdict's 134,000 entries. `gate` is present, `gates` is not. Lemmatisation before lookup is mandatory; without it, "absent from the prevalence data" would misfile every inflected form of every common word as an obscure Bonus Word.
- Prevalence sorts the tiers automatically, but a light human pass over each curated puzzle catches the handful the data gets wrong.
- Proper nouns are excluded entirely rather than tiered — see GLOSSARY.md. CMUdict was built for speech recognition on news audio and is full of surnames; without a second word list, a player typing `Kate` would earn a rare-word bonus.

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

## Amendment, 2026-11-10: the test is Retrieval, and the sitting placed the line

**The test.** The opening asks whether "a reasonable player could be expected to
know" a word. That is recognition, and it is what the prevalence data measures.
What the Answer/Bonus split is really drawn on is Retrieval: whether a player,
given the Seed Word, will produce the word from nothing (GLOSSARY.md). Prevalence
is the proxy for it, and an upper bound: nobody produces a word they do not know.
The line at 0.0 was placed to keep `defenestrate` an Answer, and it made Answers of
words nearly everybody recognises and almost nobody would think of.

**Where the line came from.** The maintainer marked 150 Answers drawn from the
scheduled days, 15 from each 0.25 band of knownness from 0.0 to 2.5, with the
knownness hidden: E (a player would produce it easily), H (a player would produce
it, with effort) or B (a player would not produce it). The marks came out 68 E,
27 H and 55 B, and are committed in `data/judge-labels/tier-1.json` (#309, #310).
B is the majority in every band below 1.00 and in none from 1.00 up, so the
Answer line is **1.00** (`ANSWER_LINE` in `src/verdict.ts`).

**The comparison.** Holding out one mark at a time, knownness alone called 81.3% of
the marks right, frequency 73.3%, and the two combined 77.3% (0.7 points better
than knownness in sample, 4.0 points worse held out). So the axis stands:
prevalence, not frequency and not a mix. The objection this ADR opened with still
holds, now measured rather than argued.

**The anchor word** is `docility` (1.03, marked H), for `facility`: a word a player
hunting rhymes for `facility` will produce, if not often, and which only just
clears the line. `servility` (0.84), which almost everybody recognises and few
would produce, falls below it. `defenestrate` (0.25) is no longer the anchor. It is
a Bonus Word: famous as a rare word, and still not one a player reaches for when
hunting rhymes for `ate`. The test in `src/__tests__/tiers.test.ts` that pinned it
as an Answer now pins `docility` and `servility` instead.

The Resolution's "around 0.0" is superseded. Its probe still stands as a ranking
result: prevalence orders `defenestrate` above `objurgate`. The rare line moved
with the Answer line, recorded in ADR-0006 and ADR-0007. ADR-0015 is unchanged:
the per-word override is still the lever for a ranking inversion, which no line
can fix.
