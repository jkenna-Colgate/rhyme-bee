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
