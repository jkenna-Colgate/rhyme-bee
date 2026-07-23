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
The single accent the game adjudicates in. Rhyme is a property of a word pair *in an accent*, so the game commits to one and says so. Under any other accent some verdicts will be wrong, and that is an accepted cost.

**Homophone**:
A word that sounds identical to another but is spelled differently. Homophones of the Seed Word rhyme with it and count as valid.

**Puzzle**:
One day's game: a Seed Word and the set of words that rhyme with it. Seed Words are curated in advance so that each Puzzle's answer set lands in a playable size band, rather than swinging between twelve answers and five hundred.

**Tutorial**:
The unscored first-run Puzzle, seeded with `ate`. It exists to teach that the game is about sound and not spelling, and is exempt from the size band that governs shipped Puzzles.

**Submission**:
A word the player enters as an attempted rhyme for the Seed Word. Each Submission resolves to an Answer, a Bonus Word, or a rejection. The Seed Word itself and any word already accepted this Puzzle are rejected.

**Answer**:
A Submission that rhymes with the Seed Word and is a word a reasonable player could be expected to know. The test is knownness, not corpus frequency: `defenestrate` is rare in print but widely known, so it is an Answer, and a long rare one, which makes it among the highest-scoring words in the game.

**Bonus Word**:
A Submission that rhymes and is a genuine English word, but one almost nobody knows — `objurgate`, `tergiversate`. Accepted and celebrated as a find rather than treated as an error, but not counted toward the Puzzle.

**Score**:
The player's running point total for a Puzzle, summed over the Answers they have found. Length dominates rarity: an Answer scores mainly on length, with a small flat bonus for a rare (low-knownness) one — so a long, rare word like `defenestrate` is among the highest-scoring finds. Length is the primary driver, but because the rarity bonus is a flat amount, a much rarer short word can occasionally edge past a slightly longer common one. Bonus Words score nothing; they are celebrated, not counted. The formula is configurable and tuned against real play.
_Avoid_: Points, total

**Rank**:
The player's progress tier within a single Puzzle — the thing the game congratulates you for reaching, in the spirit of Spelling Bee's "Genius". It is the player's current Score as a percentage of the Puzzle's maximum achievable Score (the sum of every Answer's points), mapped onto an ordered ladder of named tiers. Because it is a percentage of a per-Puzzle maximum, Rank is comparable across days and adapts to Puzzles of any size without retuning. Bonus Words never affect it. Rank is per-Puzzle and resets each day.
_Avoid_: Level, grade, score (Rank is derived from Score, it is not the Score itself)

**Proper Noun**:
A name. Never valid, however well it rhymes, because the space of names is unbounded and has no defensible edge. Rejected with a reason of its own, since `Kate` obviously rhymes with `ate` and a silent refusal reads as a bug.
