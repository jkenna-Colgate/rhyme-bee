# Rhyming Game

A daily word puzzle in the spirit of NYT Spelling Bee, but the mechanic is sound rather than spelling: the player is given one word and hunts for as many words as possible that rhyme with it.

## Language

**Seed Word**:
The single word a Puzzle is built around, shown *and spoken* to the player at the start. Speaking it is not a convenience feature: the game adjudicates against a pronunciation, so that pronunciation is established out loud before play rather than discovered through rejection.
_Avoid_: Prompt, target, clue, base word

**Rhyme Key**:
The sequence of sounds running from a word's last stressed vowel to the end of the word. `ate` and `impregnate` both have the Rhyme Key /eɪt/. Stress may be primary or secondary — `IM-preg-nate` qualifies on its secondary stress. A spelling may have more than one Rhyme Key, because it may have more than one pronunciation: `tear` has both /ɪr/ and /ɛr/.

**Rhyme**:
Two words rhyme when they share a Rhyme Key. Spelling is irrelevant: `eight` rhymes with `ate`, `chocolate` and `commensurate` do not (their final vowel is an unstressed schwa, not /eɪ/). A Submission rhymes if *any* of its Rhyme Keys matches, so `read` is a legitimate rhyme for `bed` — the Seed Word, by contrast, is pinned to exactly one.
_Avoid_: Perfect rhyme, slant rhyme, near rhyme (this game has only one kind of rhyme)

**General American**:
The single accent the game adjudicates in — specifically *merged* General American, which has the cot–caught merger, so `stalk` rhymes with `stock` and `ball` with `doll`. Rhyme is a property of a word pair *in an accent*, so the game commits to one and says so. Under any other accent some verdicts will be wrong, and that is an accepted cost. See [ADR-0002](./docs/adr/0002-general-american-is-the-only-accent.md).

**Normalisation**:
The build stage that rewrites pronunciations before any Rhyme Key is computed, so the game adjudicates in the accent it claims to — it does not reject `talked` for `docked` over a difference nobody can resolve. It is *not* a loosening of the Rhyme rule, which is unchanged: it changes the reading, not the test. A normalisation either **replaces** a reading, admissible only if the contrast it erases is genuinely inaudible, or **appends** one, admissible only if its reach has been measured and its error rate stated. Either way a committed guardrail set must survive intact. See [ADR-0010](./docs/adr/0010-normalisation-erases-inaudible-contrasts.md).
_Avoid_: Fuzzy matching, near rhyme, tolerance (all imply the rhyme test got looser — it did not)

**Homophone**:
A word that sounds identical to another but is spelled differently. Homophones of the Seed Word rhyme with it and count as valid.

**Puzzle**:
A Seed Word and the set of words that rhyme with it. Seed Words are curated in advance so that each Puzzle's answer set lands in a playable size band, rather than swinging between twelve answers and five hundred. Most play is on the Daily Puzzle, but the Tutorial and Free Play produce a Puzzle too — a Puzzle is not inherently tied to a date.

**Daily Puzzle**:
The Puzzle scheduled for a given calendar date, and the only kind whose Session is kept. The date is the player's own local calendar date, so the day turns over where the player is rather than where the game is hosted.
_Avoid_: "the puzzle of the day" as a separate concept, today's game

**Free Play**:
A Puzzle drawn at random from the Seed pool rather than taken from the schedule, carrying no date. It is both something a player chooses — an extra, once the Daily Puzzle is done — and what the game offers when the schedule has nothing for the player's date, on a visit before the run begins or after it ends. A Free Play Session is never kept: it is a Puzzle to play now, not a day to come back to.
_Avoid_: Practice mode, random puzzle, endless mode, casual mode

**Tutorial**:
The unscored first-run Puzzle, seeded with `ate`. It exists to teach that the game is about sound and not spelling, and is exempt from the size band that governs shipped Puzzles. It carries no date, so it is not a Daily Puzzle and its Session is not kept — a first-time player still meets the day's Puzzle on their next visit.
**Switched off for the playtest** ([#130](https://github.com/jkenna-Colgate/rhyme-bee/issues/130)): the term and its design stand, but no player currently reaches one. A first visit opens the Daily Puzzle directly, and the sound-not-spelling sentence now lives in the ordinary start gate. `TUTORIAL_ENABLED` in `web/src/bootPuzzle.ts` is the one word that brings it back.

**Session**:
One player's play-through of a single Puzzle: the words they have found, and the Score, Rank and progress derived from them. The Daily Puzzle is the shared content of the day; the Session is one person's engagement with it. A Session on the Daily Puzzle outlives the tab that played it and resets when the date turns over; a Tutorial or Free Play Session is not kept at all.
_Avoid_: Game (the whole product is "the game", and one day's game is the Daily Puzzle), playthrough, run

**Reveal**:
The end-of-game disclosure of what the player never found — the missed Answers, and the Bonus Words they never reached. It is a **give-up gate, not a peek**: taking the Reveal ends the Session, which is what keeps the Score and Rank it freezes honest. A Reveal a player could take mid-Puzzle and then carry on from would quietly empty Rank of meaning, since the remaining Answers would be there for the copying. Helping a player who is stuck *keep playing* is not the Reveal's job and belongs to the hint system; the two are deliberately separate mechanics.
_Avoid_: Hint (a hint helps you keep playing, a Reveal ends the play), "show answers" as something available mid-Puzzle

**Submission**:
A word the player enters as an attempted rhyme for the Seed Word. Each Submission resolves to an Answer, a Bonus Word, or a rejection. The Seed Word itself and any word already accepted this Puzzle are rejected.

**Answer**:
A Submission that rhymes with the Seed Word and is a word a reasonable player could be expected to know. The test is knownness, not corpus frequency: `defenestrate` is rare in print but widely known, so it is an Answer, and a long rare one, which makes it among the highest-scoring words in the game.

**Bonus Word**:
A Submission that rhymes and is a genuine English word, but one almost nobody knows — `objurgate`, `tergiversate`. Accepted and celebrated as a find rather than treated as an error, but not counted toward the Puzzle.

**Tier**:
Which of the two accepted kinds a rhyming word is — an Answer, which counts toward the Score, or a Bonus Word, which is celebrated but does not. Every rhyming word with wordhood holds a Tier whether or not any player ever submits it, so a Puzzle's Answers and Bonus Words are settled before its date begins. The split is drawn on knownness ([ADR-0003](./docs/adr/0003-word-prevalence-not-corpus-frequency.md)) — but *what* a Tier is stays separate from *how* a word arrives at one.
_Avoid_: Rank (that is the player's own progress and moves during play), box, bucket, category, class

**Retrieval**:
Whether a player, given a Seed Word, will *produce* a word from nothing — as against recognising it when shown. It is what the Answer/Bonus Word split is really drawn on, and nothing measures it directly: word prevalence measures **recognition**, and the knownness the engine carries is that measurement, standing in as a proxy ([ADR-0003](./docs/adr/0003-word-prevalence-not-corpus-frequency.md)). For most vocabulary the two track each other closely enough that the difference never surfaces. They come apart maximally on transparent prefix compounds — a reader shown `counterthrust` can obviously decode it and tick the box, and a player hunting rhymes for `bust` will never think of it. The gap is a ranking inversion rather than a miscalibrated line (prevalence ranks `misadjust` above `readjust`), so no threshold anywhere on the scale can close it and only a per-word lever can: `data/tier-overrides.csv`, written by the Editor's Pass and merged over prevalence at build time, so no adjudication code learns that overrides exist. See [ADR-0015](./docs/adr/0015-tier-overrides-record-retrieval-not-recognition.md).
_Avoid_: Recognition (that is the proxy, not the thing), recall, familiarity, corpus frequency

**Score**:
The player's running point total for a Puzzle, summed over the Answers they have found. Length dominates rarity: an Answer scores mainly on length, with a small flat bonus for a rare (low-knownness) one — so a long, rare word like `defenestrate` is among the highest-scoring finds. Length is the primary driver, but because the rarity bonus is a flat amount, a much rarer short word can occasionally edge past a slightly longer common one. Bonus Words score nothing; they are celebrated, not counted. The formula is configurable and tuned against real play.
_Avoid_: total; "points" as a synonym for the Score itself (points are the per-Answer unit that *sums into* Score — see Points)

**Points**:
What a single Answer is worth: its length, plus a small flat bonus when it is rare (ADR-0006). The points of the Answers a player has found sum to their Score — points are the per-Answer contribution, never the running total itself. `scoreEntry` computes an Answer's points, and both the session (a game in progress) and curation (a candidate's Difficulty) score with that one function, so the unit means the same thing everywhere (ADR-0007).
_Avoid_: using "points" for the Score as a whole (that is the Score); "score" for a single Answer's points

**Rank**:
The player's progress within a single Puzzle — the thing the game congratulates you for reaching. It is the player's current Score as a percentage of the Puzzle's maximum achievable Score (the sum of every Answer's points), mapped onto an ordered ladder of named Ranks: the word names both the ladder's steps and the one a player is standing on, as it does for the rank of captain. The ladder is a rhymer's career, running from `Beginner` to `Shakespeare`. Because it is a percentage of a per-Puzzle maximum, Rank is comparable across days and adapts to Puzzles of any size without retuning. Bonus Words never affect it. Rank is per-Puzzle and resets each day.
_Avoid_: Level, grade, rung, tier (a Tier is the Answer/Bonus split, which is a property of a word rather than of a player), score (Rank is derived from Score, it is not the Score itself)

**Difficulty**:
How hard a Puzzle is to finish, as distinct from how big it is. It is the share of a Puzzle's maximum achievable Score that lives in rare (low-knownness) Answers — so a player who knows only common words tops out at a Rank of `1 − Difficulty`, and a high-Difficulty Puzzle can't be finished without digging out the words most people don't know. It is *not* the answer count: because Rank is a percentage of maximum, a Puzzle with more Answers is a longer session, not a harder one. The shipped week ramps Difficulty up monotonically, Monday easiest to Sunday hardest, so a player knows roughly how hard today will be before starting. See [ADR-0007](./docs/adr/0007-difficulty-is-rare-word-score-mass.md).
_Avoid_: using "difficulty" for answer-set size (that is a size-band / session-length concern, see Puzzle)

**Shadow Key**:
A Rhyme Key whose members are *entirely derived* — regular inflections (`-s/-es/-ed/-ing`), prefixed forms (`un-/re-/out-/…`) or suffixed ones (`-ly/-ness/-er/-ful/…`) of words that belong to another Rhyme Key — so it carries no rhyme content of its own. `downs` (/aʊnz/) is a shadow of `down` (/aʊn/): its family is the `down` family with an `s` on every word (`clowns, crowns, gowns, downtowns`). A suffix does the same thing one step further into the word: /ɛnʃəli/ is the `essential, potential, torrential` family with `-ly` on every word. A key that also holds words which are *not* so derived — `blind, mind, find` in /aɪnd/ — has **native** content and is a real Puzzle. Shadow Keys are barred from being Seed Words, so the schedule can't serve `down` one day and `downs` the next; derived words stay valid Answers wherever they rhyme. See [ADR-0008](./docs/adr/0008-seeds-need-native-rhyme-content.md).
_Avoid_: "inflected key" (inflection *density* is not the test — /aɪnd/ is inflection-heavy but native; the test is whether any native content remains)

**Proper Noun**:
A name. Never valid, however well it rhymes, because the space of names is unbounded and has no defensible edge. Rejected with a reason of its own, since `Kate` obviously rhymes with `ate` and a silent refusal reads as a bug.

**Appeal**:
A player's report that a Submission the game rejected should have counted as an Answer. It contests a verdict already delivered and never asks for one — adjudication happens in the player's browser and stays there — so raising an Appeal changes nothing about the Session it came from, and the player plays on.
_Avoid_: Flag (the maintainer-facing schedule review flags the days worth reading first, and that is the word's only other use), challenge, dispute, complaint

**Candidate**:
The record an Appeal becomes: the Submission, the reason the engine gave for rejecting it, and the context a judge needs to rule on it later. Judging is a separate pass over the Candidate Queue, and may end in a correction to the pronunciation the engine reads — so a Candidate is the report, never the fix.
_Avoid_: Suggestion, correction, fix (those name what judging may produce, not what the player sent)

**Candidate Queue**:
Every outstanding Candidate, grouped by Rhyme Key. The term covers Candidates from all three capture paths — a player's Appeal in the deployed game, a player's Appeal in dev, and the Editor's Pass disagreement — and, as a second section, the readings the add path asked an agent for and did not get. Judging it is the Editor's Pass's work rather than a pass of its own ([ADR-0017](./docs/adr/0017-candidates-are-judged-in-the-editors-pass.md)), and a Candidate whose word rhymes on its Rhyme Key against the current Rhyme Index is resolved by that fact alone, without anyone ruling on it.
_Avoid_: "the add queue", which is the existing browser-side list of words an editor has typed and not yet submitted, and is a different thing on the same screen

**Decline**:
The editor's ruling that a Candidate should not become an Answer, together with the choice of what the player is told instead. It is distinct from the engine's **rejection** of a Submission: the engine rejects mid-play from index state, and an editor declines afterwards by changing that state. A Decline is recorded against the word and the Rhyme Key together, so declining a word for one target does not hide it when it is Appealed against another.
_Avoid_: Reject (the engine's act), dismiss, close

**Editor's Pass**:
The puzzles editor's read of a Daily Puzzle before its date arrives, and the corrections that read produces. It is a *read*, not a play: the editor scans the day's Answers and Bonus Words as text — against a third-party rhyme list in another window — and never opens a Session. The term covers both halves of the loop, because they are one activity rather than two: the pass surfaces a Puzzle that has drifted out of the band it was dealt from or is missing an obvious rhyme, and the words it adds are added in the same sitting, by name alone.
_Avoid_: play-ahead, preflight, daily review

**Corrected Day**:
A Daily Puzzle as the next rebuild will produce it — every standing Tier verdict and demotion applied to the readout, with the figures re-measured. The Editor's Pass writes corrections to file but does not rebuild the index, so the screen shows arithmetic the browser did, standing in for the artifact that has not caught up. A Corrected Day whose figures differ from the built readout's has *moved*, which withdraws the band verdicts decided against the old figures.
_Avoid_: Shown day (that is the intermediate value in `demote.ts`), preview, pending day; **pronunciation correction** is a different thing and is always qualified.
