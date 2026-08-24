# A composed reading for a word the editor named is not reading manufacture

[ADR-0011](./0011-reading-manufacture-is-frozen.md) froze reading manufacture on
2026-07-30 at three normalisation rules and thirty affix rules, closed sets, and
named the sites where a correction lands instead. The Editor's Pass (#134) adds
a tool that **composes** a pronunciation: it splits a spelling into a head and a
tail that are both words the pinned sources already read, demotes the tail's
stress to secondary, concatenates, and offers the result.

That looks exactly like the thing that was frozen. A reader who finds the code
without this context will read the freeze as having been quietly broken, so the
distinction is recorded here, before the loop is in daily use.

**ADR-0011 governs build-time rules that manufacture readings for words nobody
named.** A rule reaches every word in the lexicon whose shape it matches,
whether or not anyone asked — `suffix:ly` touched 1,646 words on its own — and
it is that unasked reach which makes an unbounded rule set a scope failure.
Composition produces **one verified reading for one word the editor named**, on
the night they named it, and its output lands as a committed line in
`data/supplement.dict` — the site ADR-0011 itself directs corrections to, and
which [ADR-0009](./0009-pronunciation-supplement-is-the-permanent-override-layer.md)
established as the permanent override layer. The line is indistinguishable from
one typed by hand, because it is one: the same file, the same merge over
upstream, the same permanence.

**ADR-0011 is not amended.** Its unfreeze clause is not invoked and its trigger —
evidence that players other than the maintainer are meeting a rejection class the
frozen rules cannot reach — has not fired. `RULES` and the affix inventory stay
closed sets, and adding to either remains a change to ADR-0011 rather than a
change to a list. Nothing in the build's manufacture stages is touched.

## Verification is author-blind

One predicate decides: a reading is accepted only when its computed Rhyme Key
equals the Rhyme Key it is being added to. The composition goes through it, an
agent asked to author an awkward case goes through it, and so does a human. It
is the same function in all three paths, which is what makes the guarantee
statable at all.

This is a **stronger** guarantee than hand-authoring, where nothing checks the
author. It is the argument for the whole approach: the objection to a machine
writing pronunciations is that no one is reading them, and here something is,
mechanically, every time.

### The known limit, accepted rather than mitigated

Verification constrains a reading from its last stressed vowel onward. It cannot
constrain the head. A composition that gets `placeholder`'s first syllable wrong
would still be accepted if its tail lands on the target key.

A wrong head never changes a verdict — adjudication compares only Rhyme Keys, so
everything before the last stressed vowel is invisible to it. It would be
*audible* in one place: if that word were later drawn as a Seed Word, which
[ADR-0002](./0002-general-american-is-the-only-accent.md) makes load-bearing to
speak aloud before play. That is the bound, and it is why this is recorded as
accepted rather than fixed: the exposure is one word class in one screen, and
Seed Words are curated and heard by the editor before they ship.

### The measurement is seven out of seven, which is seven

Composition resolved all seven compounds found while specifying #134 —
`placeholder`, `candleholder`, `toothache`, `earache`, `handbrake`, `windbreak`,
`beefcake` — and the machine's `placeholder` (`P L EY1 S HH OW2 L D ER0`) is
identical to the hand derivation. Seven is not a hit rate. Stated plainly here
in the manner ADR-0011's own measurement discipline demands, because a small
number presented as a result is how a rule set starts accumulating again.

The **deferred queue** is the instrument that replaces it. Every word the
composition cannot resolve is appended rather than discarded, so after a week of
real nights the miss rate is a count rather than an impression, and a second
composition rule can be decided from that number instead of from the next
frustrating word.

### The boundary is measured: 0.12% against one key, 62% against many

Seven out of seven measured *reach* — how much composition resolves. It says
nothing about whether an accept is **correct**, which is a different number and
the one the scope line rests on. That line — *one* verified reading for *one*
word the editor named — reads as a preference about tidiness. It is not. It is
where the accept predicate stops working, and the distance either side of it was
measured on 2026-08-24.

Method: take the 27,039 words with knownness >= 0.9 that **already** have a
reading, discard it, run `composeReading` as though the word were unread, and
compare the composed Rhyme Key with the one the real reading yields. The truth is
known for every word, so every accept is scoreable.

| aimed at | composed onto a key | wrong |
|---|---|---|
| one key, named by the editor | 32 | **0.12%** |
| all 260 scheduled keys | 11,132 | **62.0%** |
| all 260, compound-only guard | 4,564 | **49.3%** |

The percentages are of the compositions *accepted*, not of the 27,039.

With one target the predicate verifies. With many it **shops**. A spelling can be
cut at every position, each cut is tried against every key, and something almost
always lands somewhere: `abandoned` cuts to `abandon+ed` and reaches `EH D`,
`abortion` to `abort+ion` and reaches `AA N`, `protractor` to `protract+or` and
reaches `AO R`, `accost` to `acc+ost`. Each is a valid composition of two real
readings, each is wrong, and nothing in the predicate distinguishes them from
`spear+mint` — it sees one key at a time and cannot know it was handed 260
chances at it.

The compound-only guard — both halves at least three characters, tail not in a
suffix blocklist — was the obvious mitigation, and it bought 62.0% down to 49.3%.
Half of what it accepts is still wrong. The problem is not suffixes, and no
refinement of the guard reaches it: the failure is the *number of targets*, which
is the one thing a guard on the split does not touch.

So the editor naming the word is not a workflow detail to be relaxed for
throughput later. It is the whole of the guarantee. A batch that supplies its own
targets is a different mechanism with a two-in-three error rate wearing this
one's name.

## Considered Options

**Keep asking the editor to hand-author ARPAbet.** The status quo. Rejected: the
editor has ruled it out, and it is the one part of the loop they will not do.
Without an answer to it the Editor's Pass produces findings that never become
fixes, which is worse than not reviewing — the defect is then known and still
shipped.

**Treat composition as a new manufacture rule and unfreeze ADR-0011.** Rejected.
It is not build-time, it reaches no word nobody named, and the unfreeze clause's
stated trigger is a rejection *class* met by strangers, which is not what is
happening here. Invoking the clause for something outside its scope would spend
it and teach the next reader that it is spendable.

**Accept the agent's proposed reading without verification.** Rejected: it puts
an unchecked generator where ADR-0011 put a human. The freeze's actual concern is
readings entering the game that nobody has checked, not the letter of which
module writes them.

**Compose every unread word against every scheduled key and let verification
sort them.** The apparent free lunch: the accept predicate already exists, so
point it at the lexicon and harvest what passes. Rejected on the ablation above —
62.0% of what it accepts is wrong, 49.3% with the obvious guard. Verification is
only verification when it is *given* the target; supplied with 260 of them it
degenerates into search. Recorded because the idea is genuinely attractive from
the code, and its defect is invisible without the measurement.

**Send every word to the agent and build no composition.** Rejected. The
composition is deterministic, free, inspectable and measured; the agent is none
of those. Composition first, agent as the fallback for what it cannot resolve.

## Consequences

- **The freeze stands.** This ADR does not amend ADR-0011, does not invoke its
  unfreeze clause, and leaves `src/normalise.ts` and `src/affixes.ts` closed.
- **`data/supplement.dict` remains the correction site**, and now gains entries
  by machine as well as by hand. Both arrive through the same verification.
- **A composed entry carries no per-entry comment.** The reason for an add is
  constant — the word was absent from the pinned sources — so a sentence
  restating it on every line carries no information. The existing hand-authored
  comments are history, not a convention to extend.
- **Composition only fills a gap; it never overrides.** A word that already has a
  reading which does not rhyme is a *correction*, and correcting an upstream
  pronunciation by machine is a materially bigger claim than this ADR licenses.
  Those stay the deliberate hand-edit they are today.
- **A fix is global**, unchanged from ADR-0011: an added reading applies to every
  Puzzle that word appears in, which is what makes the nightly workload decay
  instead of recur. Per-Puzzle answer-set overlays stay barred.
- **The editor naming the word is load-bearing**, and measured: 0.12% wrong
  against one key, 62.0% against many. It is a correctness boundary rather than a
  scoping preference, so a proposal to batch composition over words nobody named
  is a proposal to accept a two-in-three error rate, whatever else surrounds it.
- **A second composition rule is deferred** until the deferred queue can decide
  it from a number. Proposing one before then is proposing it on the same
  evidence the freeze was written to stop.
