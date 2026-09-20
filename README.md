# Rhyming Bee

A daily word puzzle in the spirit of NYT Spelling Bee, with one substitution:
the mechanic is **sound**, not spelling. You are given one Seed Word, spoken
aloud as well as shown, and you hunt for as many words as you can that rhyme
with it.

**[Play today's Puzzle](https://bramble-bee.kenna-dev.workers.dev)**. It is a
friends-and-family playtest rather than a finished product, so expect rough
edges and the occasional word it gets wrong.

Building it turned out to be mostly not a programming problem. Deciding what
counts as a rhyme is easy until you try to write it down, at which point you
have to rule on whether `chocolate` rhymes with `ate` (it does not), whether
`stalk` rhymes with `stock` (in this game, yes), and which single accent the
game adjudicates in, given that rhyme is a property of a word pair in an accent
and no two speakers quite share one. Every one of those rulings is written down,
including the ones that were made, shipped, and then reversed.

## Start here

- **[CONTEXT.md](./CONTEXT.md)**: the glossary. Seed Word, Rhyme Key, Answer,
  Bonus Word, Session, Rank. Each entry carries an _Avoid_ list, which is the
  half that does the work.
- **[docs/adr/](./docs/adr/)**: the decisions, and why the obvious alternatives
  were rejected. [ADR-0001](./docs/adr/0001-rhyme-is-the-last-stressed-syllable.md)
  (what a rhyme is) and
  [ADR-0003](./docs/adr/0003-word-prevalence-not-corpus-frequency.md) (which
  words a player can be expected to know) were both reversed mid-design and
  record it, so they are the two worth reading first.

## The rules, in short

Two words rhyme when the sounds from their **last stressed vowel** onward match,
primary stress or secondary. That sequence of sounds is a word's Rhyme Key, and
two words rhyme when they share one. So `impregnate` rhymes with `ate` on its
secondary stress, and `chocolate` does not, because its final vowel is an
unstressed schwa rather than the /eɪ/ of `ate`. Spelling is irrelevant, so
`eight` counts.

The game adjudicates in General American, and says the Seed Word out loud before
you start, because a rhyme is only a rhyme in an accent. Committing to one
accent means some verdicts are wrong under yours. That is a stated cost rather
than an oversight ([ADR-0002](./docs/adr/0002-general-american-is-the-only-accent.md)).

Every rhyming word that is a word at all holds one of two Tiers. An **Answer**
scores and counts toward your Rank. A **Bonus Word** is a real word almost
nobody knows (`objurgate`, `tergiversate`), and is celebrated as a find without
counting. Names are neither: `Kate` obviously rhymes with `ate`, and is refused
with a reason of its own, because the space of names has no defensible edge.

Rank runs from Beginner to Shakespeare as a percentage of the Puzzle's maximum
Score, so it means the same thing on a day with thirty Answers and a day with a
hundred.

## How this was built

Most of the code here was written by coding agents, and the repository is shaped
around that. The glossary and the ADRs are durable context: they are what an
agent reads at the start of a session instead of being told the same things
again, and they are imported into every session rather than discovered. Issues
are the unit of work, specified to the point where an agent can pick one up cold
and finish it, and several run in parallel in their own git worktrees. Commit
messages and ADRs cite issue numbers heavily, because that trail is how the next
cold session finds its way back to the reasoning.

The honest claim is not that agents made this fast. It is that the design
discipline is what made the agent work tractable at all. An agent with no memory
between sessions will cheerfully reinvent a decision you already made and
rejected, propose the alternative an ADR spends four paragraphs declining, and
quietly rename Free Play to "practice mode" on the way past. Writing the
glossary and the ADRs would have been worth doing for a solo project anyway.
They only became load-bearing once something else was doing the typing, and the
_Avoid_ lists exist because vocabulary drift is the first symptom you notice.

## Where things are

Besides the glossary and the ADRs above:

- **[docs/data.md](./docs/data.md)**: the build pipeline, its pinned data
  inputs, and their licences.
- **[docs/deploy.md](./docs/deploy.md)**: how the game reaches players, the
  daily refine loop, and rolling a bad deploy back.
- **[docs/editors-pass.md](./docs/editors-pass.md)**: the read a puzzles editor
  does on a Daily Puzzle before its date arrives.
- **`src/rhymeIndex.ts`**: the single seam, `adjudicate` and `buildPuzzle`.
- **`web/`**: the player-facing front end, which carries its own package.

## Building and testing

```
npm install
npm test              # the verdict-table suite
npm run typecheck
npm run build:index   # build the index from pinned data in data/ (uncommitted)
npm run histogram     # answer ADR-0004: how many playable Rhyme Keys exist
npm run play          # play a Puzzle in the terminal
npm run deploy        # build the index and the shell, and ship both (docs/deploy.md)
```

`play` and `histogram` draw Seed Words from a playable size band, set by the
`BAND_MIN` / `BAND_MAX` env vars (default `20` / `120`).
`play` takes `--day 1..7` (1 easiest to 7 hardest) or `--seed <word>`.

On Windows PowerShell, passing those flags has two separate traps that fail
silently. See [docs/powershell.md](./docs/powershell.md) before you spend an
afternoon on it.

## Licence and data

MIT, see [LICENSE](./LICENSE). That covers the code and the hand-authored data
files committed alongside it: the pronunciation supplement, the demotion list,
the Tier override file, the schedule, and the declines and deferred-readings
records.

It does not cover the upstream data the build reads, which is pinned rather than
committed and carries its own terms. [docs/data.md](./docs/data.md) records the provenance and licence
of each source; [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md) vendors the
notices that have to travel with redistributed material, CMUdict's above all.

One source, the word prevalence norms behind the Answer and Bonus Word split, is
still recorded as licence unconfirmed. That is tracked and not papered over.
