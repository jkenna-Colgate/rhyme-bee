# A committed pronunciation supplement is the permanent override layer

The wordhood set (`data/words.txt`) and pronunciations (`data/cmudict.dict`) are uncommitted and regenerated from pinned upstream sources, so a hand-edit is wiped on the next `npm run build:index`. We add a small **committed** supplement, merged over the upstream inputs at index-build time, as the authoritative human override: it both **adds** missing words (each with a pronunciation) and **corrects** upstream pronunciations (primarily mis-marked stress). This supplement is treated as **permanent infrastructure, not a temporary patch** — any future pronunciation source will still get some words wrong, and the supplement is the ground-truth override that outlives whatever produces the base data.

## Why not a structural data overhaul instead

The trust failures that motivate this cluster in **compounds and loanwords**: valid words absent from CMUdict (`overjoy`, `airburst`) and correct words whose stress is mis-marked so the rhyme anchors on the wrong syllable (`viceroy` = `V AY1 S R OY0`, `bratwurst` = `B R AE1 T W ER0 S T` — the final full vowel is really secondary stress, not `0`). None of these is a failure of the rhyme rule (ADR-0001, which stays); they are data errors.

- **Fairness, not completeness, is the target.** Complete coverage is unreachable — there is always a next compound a player invents. The "it feels like guessing what's in CMUdict" complaint is cured by a *fair boundary* (every reasonable submission is either accepted-because-it-rhymes, or rejected-because-it-genuinely-doesn't-and-is-told-why — see #55), not by an exhaustive dictionary.
- **A structural swap imports new unfairness.** Grapheme-to-phoneme models are worst at exactly the stress marking behind the `viceroy`/`bratwurst` failures, so replacing/augmenting CMUdict wholesale risks trading a small coverage gap for a larger accuracy-noise problem — *more* unfair, not less.
- **The tail's size is empirical and unknown.** It is measured cheaply by play — the maintainer now, a friends-and-family test later. Structural data investment is **deliberately deferred and gated behind that evidence**, on the same "don't build the machine before you know the workload" reasoning that defers hosting and the full curation/prevalence machinery.

## Consequences

- **Adds and corrections are one mechanism** — asserting an authoritative pronunciation for a word, whether new or already present. Same committed file, same merge over upstream.
- An added word needs **at least one pronunciation with stress** or it still returns `not-a-known-word` (its wordhood alone is not enough). The reading may be hand-authored ARPAbet or derived from a present inflection.
- A missing lemma whose **inflection is already in CMUdict** can have its pronunciation *derived* from that inflection (`overjoyed OW2 V ER0 JH OY1 D` → `overjoy OW2 V ER0 JH OY1`). Combined with ADR-0003's lemma-level prevalence, the most-common inflectional form can supply *both* a reading and a knownness estimate for the bare lemma — this is the seed of the deferred systematic method, not built here.
- **Added words with no prevalence default to Bonus Words.** Giving them an Answer-worthy knownness needs the deferred prevalence machinery and would retroactively reshape curated puzzles' maximum score and every past Rank% (ADR-0004). Bonus-default is a deliberate temporary choice on the *scoring* axis; it heals the rejection (wound A) without perturbing curation.
- The **prevalence-by-most-common-inflection** rule and any structural data overhaul are deferred, gated behind play evidence. This ADR records the deferral so it is revisited rather than silently ossifying into a weak foundation.
