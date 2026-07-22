# Rhyme Bee

A daily word puzzle in the spirit of NYT Spelling Bee, with one substitution: the mechanic is **sound**, not spelling. You are given one word and hunt for as many words as you can that rhyme with it.

The first thing built is the **Rhyme Index** — the offline lookup that answers
"does this word rhyme with the Seed Word?". Everything else is a shell around it.

## Where things are

- **[CONTEXT.md](./CONTEXT.md)** — the glossary. Seed Word, Rhyme Key, Answer, Bonus Word.
- **[docs/adr/](./docs/adr/)** — the decisions, and why the obvious alternatives were rejected.
- **[docs/data.md](./docs/data.md)** — the build pipeline and its pinned data inputs.
- **`src/rhymeIndex.ts`** — the single seam: `adjudicate` and `buildPuzzle`.

## Building and testing

```
npm install
npm test              # the verdict-table suite
npm run typecheck
npm run build:index   # build the index from pinned data in data/ (uncommitted)
npm run histogram     # answer ADR-0004: how many playable Rhyme Keys exist
```

## The rules, in short

Two words rhyme when the sounds from their **last stressed vowel** onward match — primary stress or secondary. So `impregnate` rhymes with `ate`, and `chocolate` does not. Spelling is irrelevant; `eight` counts.

The game adjudicates in General American and says the Seed Word out loud before you start, because a rhyme is only a rhyme in an accent.

## First tasks when building

1. Compute the Rhyme Key family-size histogram — it decides whether this is a daily for years or a seasonal run, and it emits the candidate seed list. See [ADR-0004](./docs/adr/0004-puzzles-are-bounded-by-seed-curation.md).
2. Confirm the licence on the word prevalence norms, and check that `defenestrate` scores high while `objurgate` scores low. See [ADR-0003](./docs/adr/0003-word-prevalence-not-corpus-frequency.md).

## Data

- [CMUdict](https://github.com/cmusphinx/cmudict) — pronunciations with stress markers. BSD-2-Clause.
- [Word prevalence norms](https://osf.io/5fk8d/) — Brysbaert, Mandera, McCormick & Keuleers (2019). **Licence unconfirmed.**
