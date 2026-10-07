# A Weak Rhyme is accepted and not scored

A Submission that matches the Seed Word only on an unstressed final syllable
(`magic` for `trick`, `abandoning` for `wing`) is no longer rejected. It is
accepted as a **Weak Rhyme**: it scores nothing, it is shown to the player
exactly as a Bonus Word is, and it carries no label of its own.

The Rhyme rule does not change. A Weak Rhyme is not a Rhyme, ADR-0001 still
defines a Rhyme from the last stressed vowel, and no reading is manufactured to
make one. This adds a verdict, not a rule.

This is decided here and not yet built. It was settled in
[Does Trust count a rhyme on an unstressed final syllable?](https://github.com/jkenna-Colgate/rhyme-bee/issues/229),
one ticket of the effort to run the game unattended
([#218](https://github.com/jkenna-Colgate/rhyme-bee/issues/218)).

## The test

A Submission is a Weak Rhyme when all of these hold:

- it passes the ordinary gates (it is a word, not a Proper Noun, not the Seed
  Word, not a repeat);
- it is not a Rhyme on any of its readings;
- on some reading, the sounds from its last vowel to the end of the word are the
  Seed Word's Rhyme Key, and that vowel is unstressed.

There are no exceptions by vowel. The test can only pass when the Seed Word's
Rhyme Key is a single syllable, which is 170 of the 260 scheduled days.

## What the engine was rejecting

The premise this started from was wrong in a useful way. Players Appealed about
fifteen rejections of this kind, nine against the one Seed `trick`, and the
ticket supposed most of them ended in a full unstressed vowel that a narrower
rule could admit. That narrower rule already exists. Stress promotion (rule 3 in
`src/normalise.ts`, ADR-0010) gives a full vowel in a closed final syllable a
second reading with stress on it, so `nightingale`, `catalog`, `metaphor` and
`candidate` are accepted today. Its second limit is "never a reduced vowel", and
it counts `AH0`, `IH0` and `ER0` as reduced. Every Appeal sat behind that limit:
`magic` ends in `IH0`, and `muffin`, `basin` and `latin` end in `AH0`, the same
vowel as `chocolate`.

Counted over the Answer band, across the scheduled one-syllable Seeds, net of
what the engine already accepts:

| Unstressed final vowel | Words rejected | Seeds touched |
|---|---|---|
| `IH0` (`magic`, `abandoning`, `activist`) | 7,827 | 21 |
| `ER0` (`abductor` for `blur`) | 5,799 | 9 |
| `AH0` (`bishop`, `chocolate`, `muffin`) | 3,353 | 12 |
| any other vowel (`thyroid` for `steroid`) | 170 | 12 |

The last row is the stated cost of stress promotion's other two limits.

## Why no rule draws the line

The maintainer said ten pairs aloud. `abandoning` for `wing`, `activist` for
`list` and `bishop` for `makeup` were strong rhymes. `magic` for `trick`,
`visited` for `grid`, `budgets` for `blitz`, `finish` for `dish`, `victim` for
`him`, `chocolate` for `hut` and `muffin` for `one` were weak. The strong ones
and the weak ones share a vowel and a stress mark: `abandoning` and `magic` both
end in `IH0`, `bishop` and `chocolate` both in `AH0`.

So the reduced-vowel limit is right about some of these words and wrong about
others, word by word, and nothing in a reading tells them apart. That is the
pattern this repository has met before (ADR-0011): a rule laid over this
material is right about something and says nothing about where to stop.

## Considered Options

**Leave them rejected; the rule is right.** This was the first answer, and it
did not survive the ear test. `abandoning` for `wing` is a rhyme to the person
whose ear the game was built on, and the Playability Bar's Trust part says an
obvious rhyme is never rejected.

**Change the rule: drop the reduced-vowel limit, or move `IH0` out of it.**
Rejected. It admits the weak pairs with the strong ones, because they are the
same shape, and it does so as scoring Answers. `trick` would go from 55 Answers
to 765. The size is not the argument (the Seed pool was cut early and could be
cut again). The argument is that every weak pair would then be a False Accept.

**Avoid Seeds that invite it.** Rejected. It is an automated Seed gate, which
ADR-0012 retired, over about 42 scheduled Seeds, and the Seeds it would remove
(`trick`, `win`, `list`, `wing`) are ordinary good ones.

**A judge rules on each word, accept or reject.** Rejected as the mechanism for
this class. It needs a judge that is accurate on stress, which is where language
models are weakest ([#220](https://github.com/jkenna-Colgate/rhyme-bee/issues/220)),
and a wrong ruling either way is a visible error. A judge is still wanted, for
missing readings, and is the subject of a ticket of its own.

**Accept it under a label of its own ("near rhyme").** Rejected. A label is a
claim about the word, and it would be wrong about `abandoning` for anyone who
hears a full rhyme there. A player told that a rhyme they hear is only a near
one is as badly served as a player who is refused. The existing Bonus Word badge
says nothing about rarity or rhyme quality, so it claims nothing that could be
false.

**A rejection reason of its own ("the stress falls earlier").** Rejected for the
same reason, and one more: the engine cannot tell `magic` from `heretic`, which
is a stress mark CMUdict got wrong (it marks `lunatic` and omits `heretic`). The
message would be confidently wrong about exactly the words the engine has wrong.

## Consequences

- **Score, Rank, Difficulty and the size band do not move.** A Weak Rhyme scores
  nothing and is not part of any Puzzle's maximum.
- **Trust holds for this class with nobody judging it,** and No False Accepts
  holds as worded, since nothing weak is scored as an Answer.
- **The leeway is real and not unlimited.** A player who hears `abandoning` as a
  full rhyme gets an acceptance that scores nothing, which is a softer refusal.
  So the Appeal widens: a player can Appeal any Submission that was not counted
  as an Answer, a Bonus Word and a Weak Rhyme included. The player cannot tell
  those two apart on screen, so the control cannot differ between them.
- **A Weak Rhyme is not a Bonus Word in the model.** It holds no Tier, it is
  worked out at submission and not settled before the date, and the Reveal never
  lists one. `wing` alone has thousands.
- **Promotion stays possible and is not required.** A Weak Rhyme the maintainer
  or a judge hears as strong becomes an Answer the ordinary way, by a reading in
  `data/supplement.dict`. The Playability Bar does not depend on it.
- **Missing stress marks are still missing readings.** `heretic`, `limerick` and
  `maverick` against `lunatic` and `bailiwick` are data errors and count against
  Trust like any other; a Weak Rhyme verdict softens them and does not fix them.
- **The rejection message changes** from "doesn't rhyme with the Seed Word" to
  wording that claims less, such as "not on our rhyme list". Most rejected
  rhymes players Appeal are missing readings, so the old message was false in
  most of the cases players cared about.
- **ADR-0011's freeze is not broken.** No reading is manufactured and no
  normalisation rule is added or loosened. Stress promotion keeps all three of
  its limits.
- **The glossary line "this game has only one kind of rhyme" is reversed** to
  "only one kind of Rhyme scores".

## What would reverse this

Appeals or Session Records showing that players treat an unscored acceptance as
a refusal, or a judge accurate enough on stress to separate the strong pairs
from the weak ones, in which case the strong ones can be Answers and the rest
can go back to being rejected.

## Amendment (2026-10-07): the test holds in either order, and is narrower

Settled in
[Which rhymes score, which are accepted without scoring, and which are rejected?](https://github.com/jkenna-Colgate/rhyme-bee/issues/232).
The verdict stands: a Weak Rhyme is accepted, scores nothing, and is shown as a
Bonus Word with no label. **The test under it is replaced, and the replacement
is provisional.** Still decided and not built.

### The test now

The third condition of "The test" above is replaced. A Submission is a Weak
Rhyme when it passes the ordinary gates, is not a Rhyme on any reading, and:

- the last syllable of the Submission and the last syllable of the Seed Word
  have the same rime;
- that syllable is stressed in one of the two words and unstressed in the other;
- the shared rime is a vowel that is actually said, and at least one consonant
  after it.

"There are no exceptions by vowel" and "the test can only pass when the Seed
Word's Rhyme Key is a single syllable" are both withdrawn.

**Either order.** The maintainer ruled that if one word guessed for another gets
a verdict, the second guessed for the first gets the same one. So `trick` is a
Weak Rhyme for `magic`, which the old test rejected because the Rhyme Key of
`magic` is two syllables. A Weak Rhyme is symmetric and stops there. It does not
have the substitution property a Rhyme has (ADR-0001, amended the same day):
`magic` and `academic` are both Weak Rhymes for `trick` and not for each other,
and two words that match only on unstressed endings (`magic` for `attic`,
`commander` for `boulder`) stay rejected.

**A vowel that is actually said.** The weak `AH0` directly before `L`, `M` or
`N` drops out when the word is said (`delusion` is "zh'n", and the engine
already holds that reading). What is left to share is a consonant and no vowel.

**At least one consonant after it.** Without stress, one shared sound is too
little: `fur` and `boulder` share "er", `tree` and `facility` share "ee".

The maintainer's rulings by name, each in either order:

| Pair | Verdict | Why |
|---|---|---|
| `idiotic` / `trick` | Weak Rhyme | "ih" and `k` |
| `bishop` / `makeup` | Weak Rhyme | "uh" and `p` |
| `delusion` / `sun` | rejected | the vowel drops |
| `boulder` / `fur` | rejected | a vowel alone |
| `facility` / `tree` | rejected | a vowel alone |

### What it moves

Answer-band words over the scheduled Seed Words. The first column is the 17,149
words the table under "What the engine was rejecting" counts; the second is new.

| Shared last syllable | Short Seed Word, long Submission | Long Seed Word, short Submission |
|---|---|---|
| Accepted: a vowel and a consonant | 10,858 on 49 Seeds | 1,215 on 28 Seeds |
| Rejected: a vowel alone | 3,696 on 3 Seeds | 4,389 on 39 Seeds |
| Rejected: the vowel drops | 2,595 on 2 Seeds | 573 on 23 Seeds |

So about 6,300 words this ADR accepted are rejected again, among them every
"-er" word for `blur` and `abbreviation` for `one`. What stays accepted is
mostly endings: `wing` 4,715, `messieurs` 1,649, `grid` 1,470, `trick` 710,
`hut` 328.

Of the ten pairs said aloud for this ADR, the new test rejects one, `muffin` for
`one`, which was heard as weak then. It still accepts `chocolate` for `hut`.

### Why provisional, and why that is safe

"Why no rule draws the line" was met again. Three lines were tried in one
sitting, and for each one words landed on both sides for the maintainer. This
test matches the five pairs ruled by name and will be wrong about some endings.
It is kept because nothing else reads the line it draws:

- It sits between "accepted without Points" and "rejected". Score, Rank and
  Difficulty do not move wherever it falls.
- The Playability Bar does not read it. Trust is about an obvious rhyme being
  rejected, and No False Accepts is about what is scored.
- The engine works a Weak Rhyme out from the readings. **No judge is asked about
  one, and no label is written for one.** Unstressed endings were the judge's
  worst kind, so this is the dependency that had to be cut.
- A Weak Rhyme is computed when it is submitted. Moving the line is one test,
  with no schedule, Rhyme Index or stored Score behind it.

**A known fault of this line.** The same ticket ruled weak "ih" and weak "uh"
one sound inside a scoring Rhyme (ADR-0011, amended the same day). This test
still reads the weak vowel as the dictionary wrote it, so `aspirin` for `win` is
a Weak Rhyme and `muffin` for `win` is not. That turns on the dictionary's
symbol. An earlier ruling on the ticket had accepted `muffin` for `win` by
swapping the two weak vowels here; it is withdrawn, because the swap is also
what lets `abbreviation` in for `win`, 8,197 words on 35 Seed Words. A word
people do say with "ih" is corrected by a reading of its own.

### "Missing stress marks", narrowed

The consequence above called `heretic`, `limerick` and `maverick` data errors.
That is now three cases:

- A compound missing a mark (`drumstick`, `carsick`) is a missing reading, and
  it scores once the mark is there.
- `limerick` and `pyramid` are less settled.
- Words shaped like `heretic`, `maverick`, `lunatic` and `synonym` are **not
  ruled**. Each keeps the mark the engine holds and no judge is asked about it,
  until
  [On a weak-vowel Seed Word, where do Points stop?](https://github.com/jkenna-Colgate/rhyme-bee/issues/233)
  settles it.

### What would reopen the test

Session Records, which keep every rejection, showing which unstressed endings
players actually submit. That is evidence no ear in this repository has
supplied.
