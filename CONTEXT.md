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
The build stage that erases contrasts a General American listener cannot hear, by rewriting pronunciations before any Rhyme Key is computed — so the game does not reject `talked` for `docked` over a difference nobody can resolve. It is *not* a loosening of the Rhyme rule, which is unchanged: it changes the reading, not the test. A normalisation is admissible only if the contrast it erases is genuinely inaudible and a committed guardrail set survives intact. See [ADR-0010](./docs/adr/0010-normalisation-erases-inaudible-contrasts.md).
_Avoid_: Fuzzy matching, near rhyme, tolerance (all imply the rhyme test got looser — it did not)

**Homophone**:
A word that sounds identical to another but is spelled differently. Homophones of the Seed Word rhyme with it and count as valid.

**Puzzle**:
One day's game: a Seed Word and the set of words that rhyme with it. Seed Words are curated in advance so that each Puzzle's answer set lands in a playable size band, rather than swinging between twelve answers and five hundred.

**Tutorial**:
The unscored first-run Puzzle, seeded with `ate`. It exists to teach that the game is about sound and not spelling, and is exempt from the size band that governs shipped Puzzles.

**Session**:
One player's play-through of a single Puzzle: the words they have found, and the Score, Rank and progress derived from them. The Puzzle is the shared content of the day; the Session is one person's engagement with it, and it resets each day.
_Avoid_: Game (the whole product is "the game", and one day's game is the Puzzle), playthrough, run

**Reveal**:
The end-of-game disclosure of what the player never found — the missed Answers, and the Bonus Words they never reached. It is a **give-up gate, not a peek**: taking the Reveal ends the Session, which is what keeps the Score and Rank it freezes honest. A Reveal a player could take mid-Puzzle and then carry on from would quietly empty Rank of meaning, since the remaining Answers would be there for the copying. Helping a player who is stuck *keep playing* is not the Reveal's job and belongs to the hint system; the two are deliberately separate mechanics.
_Avoid_: Hint (a hint helps you keep playing, a Reveal ends the play), "show answers" as something available mid-Puzzle

**Submission**:
A word the player enters as an attempted rhyme for the Seed Word. Each Submission resolves to an Answer, a Bonus Word, or a rejection. The Seed Word itself and any word already accepted this Puzzle are rejected.

**Answer**:
A Submission that rhymes with the Seed Word and is a word a reasonable player could be expected to know. The test is knownness, not corpus frequency: `defenestrate` is rare in print but widely known, so it is an Answer, and a long rare one, which makes it among the highest-scoring words in the game.

**Bonus Word**:
A Submission that rhymes and is a genuine English word, but one almost nobody knows — `objurgate`, `tergiversate`. Accepted and celebrated as a find rather than treated as an error, but not counted toward the Puzzle.

**Score**:
The player's running point total for a Puzzle, summed over the Answers they have found. Length dominates rarity: an Answer scores mainly on length, with a small flat bonus for a rare (low-knownness) one — so a long, rare word like `defenestrate` is among the highest-scoring finds. Length is the primary driver, but because the rarity bonus is a flat amount, a much rarer short word can occasionally edge past a slightly longer common one. Bonus Words score nothing; they are celebrated, not counted. The formula is configurable and tuned against real play.
_Avoid_: total; "points" as a synonym for the Score itself (points are the per-Answer unit that *sums into* Score — see Points)

**Points**:
What a single Answer is worth: its length, plus a small flat bonus when it is rare (ADR-0006). The points of the Answers a player has found sum to their Score — points are the per-Answer contribution, never the running total itself. `scoreEntry` computes an Answer's points, and both the session (a game in progress) and curation (a candidate's Difficulty) score with that one function, so the unit means the same thing everywhere (ADR-0007).
_Avoid_: using "points" for the Score as a whole (that is the Score); "score" for a single Answer's points

**Rank**:
The player's progress tier within a single Puzzle — the thing the game congratulates you for reaching, in the spirit of Spelling Bee's "Genius". It is the player's current Score as a percentage of the Puzzle's maximum achievable Score (the sum of every Answer's points), mapped onto an ordered ladder of named tiers. Because it is a percentage of a per-Puzzle maximum, Rank is comparable across days and adapts to Puzzles of any size without retuning. Bonus Words never affect it. Rank is per-Puzzle and resets each day.
_Avoid_: Level, grade, score (Rank is derived from Score, it is not the Score itself)

**Difficulty**:
How hard a Puzzle is to finish, as distinct from how big it is. It is the share of a Puzzle's maximum achievable Score that lives in rare (low-knownness) Answers — so a player who knows only common words tops out at a Rank of `1 − Difficulty`, and a high-Difficulty Puzzle can't be finished without digging out the words most people don't know. It is *not* the answer count: because Rank is a percentage of maximum, a Puzzle with more Answers is a longer session, not a harder one. The shipped week ramps Difficulty up monotonically, Monday easiest to Sunday hardest, so a player knows roughly how hard today will be before starting. See [ADR-0007](./docs/adr/0007-difficulty-is-rare-word-score-mass.md).
_Avoid_: using "difficulty" for answer-set size (that is a size-band / session-length concern, see Puzzle)

**Shadow Key**:
A Rhyme Key whose members are *entirely derived* — regular inflections (`-s/-es/-ed/-ing`) or affixed forms (`un-/re-/out-/…`) of words that belong to another Rhyme Key — so it carries no rhyme content of its own. `downs` (/aʊnz/) is a shadow of `down` (/aʊn/): its family is the `down` family with an `s` on every word (`clowns, crowns, gowns, downtowns`). A key that also holds words which are *not* so derived — `blind, mind, find` in /aɪnd/ — has **native** content and is a real Puzzle. Shadow Keys are barred from being Seed Words, so the schedule can't serve `down` one day and `downs` the next; derived words stay valid Answers wherever they rhyme. See [ADR-0008](./docs/adr/0008-seeds-need-native-rhyme-content.md).
_Avoid_: "inflected key" (inflection *density* is not the test — /aɪnd/ is inflection-heavy but native; the test is whether any native content remains)

**Proper Noun**:
A name. Never valid, however well it rhymes, because the space of names is unbounded and has no defensible edge. Rejected with a reason of its own, since `Kate` obviously rhymes with `ate` and a silent refusal reads as a bug.
