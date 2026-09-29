# How other daily word games keep their word lists and schedules going

Research for [How do other daily word games keep their word lists and schedules going, and which run unattended?](https://github.com/jkenna-Colgate/rhyme-bee/issues/219), on the map [Wayfinder: run the game unattended at a Playability Bar](https://github.com/jkenna-Colgate/rhyme-bee/issues/218). Gathered 2026-09-29.

## The answer in brief

- **No game whose daily answer *set* depends on knownness is known to run unattended.** NYT Spelling Bee, Squaredle and Waffle all put a human on every puzzle, even where software proposes it. The one open-source Spelling Bee clone that runs close to unattended shows exactly our Trust and Reachability failures in its issue tracker.
- **Wordle is the one knownness-sensitive game that did run without a daily editor, for about 17 months, on a front-loaded list** (its creator never looked ahead; NYT only removed a handful of words before appointing an editor in November 2022). It worked for two reasons that do not transfer cleanly: a human read the whole pool once, up front (about 13,000 words sorted into know / don't know / maybe), and each day turns on *one* word, with a separate, generous list of accepted guesses so a player is almost never falsely rejected. Even so, obscure and regional answers slipped through, and the owner said he lived "in fear" of the next day.
- **The shared mechanism across every survivor is asymmetry: accept generously, require conservatively.** Squaredle states it as a rule ("err on the side of 'bonus word'"). Wordle accepts ~13,000 guesses but draws answers from ~2,300. Spelling Bee's congratulated rank (Genius) sits well below the full list, so the obscure tail is never needed. That is the unattended-safe lever that already exists in rhyme-bee's own vocabulary (Bonus Word), applied by default rather than by an editor's hand.
- **When a list runs out, the answer so far has been repetition under an editor**, not regeneration: Wordle began reusing answers on 2026-02-02 with no fixed minimum gap.

## Per game

Status legend: **hand-edited** (a named human signs off each day's puzzle), **curated once and replayed** (a list fixed up front, stepped through by date), **generated** (software makes the puzzle).

### Wordle

| | |
|---|---|
| Answer list | Curated once and replayed (2021-06 to 2022-11), hand-edited since |
| Horizon | ~5 weeks scheduled ahead today |
| On exhaustion | Repeats previous answers since 2026-02-02 |

- **How the list was made.** Wardle built a tool that showed his partner each five-letter word with buttons for "I know this word", "I don't know this word" and "I maybe know this word"; she went through all ~13,000, and the solution list came out at about 2,500 (Wardle to Slate, [2022-01-19](https://slate.com/culture/2022/01/wordle-game-creator-wardle-twitter-scores-strategy-stats.html)). His reason is a Trust argument: meeting an unknown answer, "you would feel cheated". The shipped list held 2,315 answers ([extracted from the original source](https://gist.github.com/cfreshman/a03ef2cba789d8cf00c08f767e0fad7b)), and the client picked the day's answer by indexing that array with days since 2021-06-19, so the whole future schedule was in the page.
- **Nobody read ahead.** Wardle "randomized" the list and said "I don't look at them. So I live in fear that tomorrow is going to be something heinous" (same Slate interview). He also names a knownness miss that got through the one-time sort (a billiards term he had never heard of).
- **What changed when NYT took over.** The per-date API ([example](https://www.nytimes.com/svc/wordle/v2/2026-09-29.json)) carries no `editor` field up to 2022-11-06 and `"editor":"Tracy Bennett"` from 2022-11-07, so the switch from replayed list to hand-edited day is visible in the data itself. Probed on 2026-09-29, dates through 2026-11-06 resolve and 2026-11-08 onward return Not Found: a rolling horizon of about five weeks. Before the editor, NYT removed words from the list (FETUS, SLAVE, LYNCH, British spellings such as FIBRE), and seven removals by July 2022 left cached copies of the old page out of sync with the live game ([Wikipedia summary with sources](https://en.wikipedia.org/wiki/Wordle)). Editing a front-loaded, client-side list mid-run broke schedule consistency.
- **How the editor picks.** Bennett: "I usually use a random number generator", then checks dictionaries and Google for profane or derogatory secondary meanings, and avoids words where four known letters still leave more candidates than guesses ([Today, 2023-01-09](https://www.today.com/popculture/wordle-editor-tracy-bennett-interview-rcna64987)). So even the edited game is a random draw from a pre-curated pool plus a human veto.
- **Complaints.** Bennett: "We get more complaints about broken streaks than anything else. People don't like when a word feels unfair in that way", then unfamiliar words ("parer") and regional ones ("a really American word") (same interview). Unfair words map to Reachability; regional words map to our accent problem (ADR-0002).
- **Running out.** NYT announced in its Gameplay newsletter on 2026-01-28 that previous answers would return; the first, on 2026-02-02, was CIGAR, the original first answer ([CNET via Yahoo](https://tech.yahoo.com/puzzles/wordle/articles/groundhog-day-wordle-started-reusing-202500660.html)). Bennett: "Though there's no strict rule, I will likely prefer words that haven't run very recently", and she will keep running first-time words too. The API confirms CIGAR on 2026-02-02 with an editor attached.

### NYT Spelling Bee

| | |
|---|---|
| Answer list | Hand-edited per puzzle |
| Horizon | Not public |
| On exhaustion | Does not arise (the pool of letter sets is combinatorial) |

- **Closest analogue to rhyme-bee**: a daily answer set whose membership is a knownness judgment. NYT describes it as "edited ... with an eye for words that can be considered familiar to a majority of solvers" (NYT 2020-10-16, [quoted by Nieman Lab](https://www.niemanlab.org/reading/the-genius-of-the-new-york-times-spelling-bee/)). Today's live page carries `"editor":"Sam Ezersky"` in its game data, alongside the day's full answer list.
- **Software proposes, a human disposes.** Ezersky: "I have a database of every possible puzzle that could be created", but "a game like this needs an editor in general rather than a computer", and he has a testing panel and "a lot of discussion around the word list on a given day" ([UVA Magazine, winter 2022](https://digital.uvamagazine.org/articles/bee-keeper/)). His test is "What feels fair to our wide-ranging audience? ... I also don't want to include something that will truly mystify the vast majority", checked against Merriam-Webster, the Mac dictionary and news coverage ([Slate, 2021-08-31](https://slate.com/culture/2021/08/nyt-spelling-bee-sam-ezersky.html)). He wants the list to "live and breathe and evolve with its audience rather than create some draconian rules" (Axios 2023-06-05, [as indexed here](https://lexiconnexxions.com/resources/sb-biblio-editor/); Axios itself refused the fetch). This is the same lesson as ADR-0011: rigid rules gave way to judgment.
- **Reachability by design.** The goal rank is Genius, not the full list, and "within a given week, about 25 percent of players will achieve Genius at least once" (NYT 2020-10-16, via Nieman Lab above). Genius is commonly reported as 70% of the day's maximum ([secondary](https://beebom.com/puzzle/spelling-bee-ranks-explained/)). Note the contrast with our own Reachability part: NYT does not aim for a typical player to reach the top named rank on most days.

### Squaredle

| | |
|---|---|
| Answer list | Licensed word list, split into required and bonus words by frequency plus judgment |
| Horizon | Not public |
| Puzzles | Computer-suggested, hand-tweaked, 5 to 30 minutes each |

- **Structurally the nearest thing to rhyme-bee's Answer / Bonus Word split.** Validity comes from the licensed NASPA list (NWL2023); the required/bonus split starts from "an American English word frequency list, so infrequently used words are typically bonus words", then dictionary labels (dialectal, archaic, obsolete), then "judgment, our own experiences, and comments from friends and the Squaredle community", including a Discord vote ([Squaredle help](https://help.squaredle.app/support/solutions/articles/151000126688-what-are-bonus-words-); [FAQ](https://squaredle.app/faqs.html)).
- **The rule that makes it safe**: "We try to err on the side of 'bonus word', since if you don't know a required word, you have to brute-force the puzzle to find it", which the FAQ calls not "very fun". That is a Reachability argument, resolved by defaulting uncertain words to the unscored tier.
- **Not unattended.** The creator, Michael Giuffrida, generated puzzles fully at random at first and gave that up; now the computer suggests and he spends "anywhere from five to 30 minutes" per puzzle, because a human touch matters; and every change to the required/bonus split draws "more feedback from people wanting me to undo that change" ([WordFinder interview, 2022-07-18](https://wordfinder.yourdictionary.com/blog/the-story-of-squaredle-talking-with-game-creator-michael-giuffrida/)).

### Open-source Spelling Bee clone (ConorSheehan1/spelling-bee)

| | |
|---|---|
| Answer list | Generated from a public word list (12dicts `2of4brif.txt`) plus committed add/remove files |
| Horizon | Deterministic by date |
| Attendance | One maintainer, intermittent ("fairly short on time") |

The best evidence of what happens to a knownness-sensitive answer-set game run nearly unattended, because its whole complaint history is public ([repo](https://github.com/ConorSheehan1/spelling-bee), live since 2022).

- **Architecture is ours in miniature**: upstream list kept unmodified so it can be re-pulled, plus `wordsAdded.txt` (51 lines) and `wordsRemoved.txt` (22 lines), the equivalent of our supplement and Demotions ([data README](https://github.com/ConorSheehan1/spelling-bee/blob/main/data/AllWords/README.md)).
- **Trust failures pile up.** The standing "Extra words" issue ([#1](https://github.com/ConorSheehan1/spelling-bee/issues/1)) collects words players expected to be accepted: the maintainer's own backlog lists about 70 (`blog`, `meme`, `texting`, `redact`, `lanyard`, `unpin` ...), and he declines others as "a bit too obscure".
- **Reachability failures too.** Required words players found obscure (`almoner` and `yuppifying` as pangrams, `baccy`, `innit`), and "lots of user feedback about the word list being inconsistent", mixed British and American ([#25](https://github.com/ConorSheehan1/spelling-bee/issues/25)).
- **Schedule fragility.** Adding words can push a letter set over the 20-word minimum, creating a new puzzle and displacing old ones; a script now checks yesterday's and today's puzzles did not move ([#17](https://github.com/ConorSheehan1/spelling-bee/issues/17)). This is our stale-Rhyme-Key problem in another shape: a list edit silently rewrites the schedule.
- **Unattended worst case.** In April 2026 two consecutive pangrams were slurs; the maintainer: "I have to explicitly remove slurs, and clearly I've missed some. I'm fairly short on time" ([#56](https://github.com/ConorSheehan1/spelling-bee/issues/56)). (Offensive content is out of scope for the map, but it shows what an unread generated list serves.)

### Semantle

| | |
|---|---|
| Answer | One secret word a day, curated once and replayed |
| On exhaustion | Not stated |

- The live FAQ, in the page bundle at [semantle.com](https://semantle.com/): "I grabbed a random list of the 'most popular' 5,000 words in English, and removed anything capitalized or with hyphens, and the word2vec stopwords ('and', 'if'). Then I shuffled it." A frequency list filtered once and replayed, with no ongoing edit. A 5,000-word list lasts about 13 years.
- The complaint that matches our Trust part is about the oracle, not the list: David Turner says the similarity scale was confusing because "sometimes the most similar words are at like 30 or 40" ([Hey, Good Game, 2024-04-30](https://www.hey.gg/blog/semantle)). A mechanical judge that disagrees with intuition is the analogue of an Answer rejected for a pronunciation reason the player cannot hear.

### Waffle

- Algorithm-generated, human-checked: "I created the original algorithm for the puzzle generation, but certain things go into creating a good puzzle where you need a human eye over it", and "we don't want words that people don't recognize or are not internationally known ... I removed the word 'dilly' the other day" (James Robinson, [Hey, Good Game, 2024-04-16](https://www.hey.gg/blog/wafflegame)). Players still complain that some words "are not real words" ([WordFinder interview](https://wordfinder.yourdictionary.com/blog/waffle-game-creator-james-robinson-talks-inspiration-behind-his-multi-word-puzzle/)).

### NYT Connections and Strands

- Both hand-made and hand-edited. The per-date APIs carry `"editor":"Wyna Liu"` for Connections and `"editor":"Tracy Bennett"` plus a named constructor for Strands; probed 2026-09-29, both resolve at least to mid-October (Strands to 2026-10-31) and not to mid-November. Liu tests each board with testers who rate it and swaps categories when testers disagree ([NYU ITP profile](https://tisch.nyu.edu/itp/news/fall-2024/connecting-with-the-editor-of-connections--wyna-liu--14); [InsideHook](https://www.insidehook.com/internet/connections-editor-wyna-liu-make-break-your-day)). Not knownness lists in our sense, but they show the industry norm: a named human per day and a rolling horizon of weeks, not years.

## Do their complaints look like ours?

| Our Playability Bar part | Their version | Where |
|---|---|---|
| Trust (an obvious rhyme is never rejected) | "Why isn't X a word?" missing-word complaints | Spelling Bee clone #1; Waffle; Semantle's scale |
| Reachability (typical player reaches the top rank) | Obscure or regional required words; "unfair" words that break streaks | Wordle (PARER, CONDO), Squaredle's rule, clone's `almoner` |
| Continuity (every date has a puzzle) | List edits displacing scheduled puzzles; cached clients out of sync | Wordle 2022; clone #17 |
| No False Accepts | Non-words or offensive words served | Clone #56; Wordle's removals |

Yes: all four parts have direct counterparts, and the loudest category in every public record is the Trust one (words the player expected to count).

## What this means for front-load versus rolling

1. **Precedent for front-loading exists only for one-answer-a-day games.** Wordle and Semantle both ran for long stretches on a list read once and replayed. Neither had to judge a whole answer set per day. Rhyme-bee does, and the only public example of an answer-set game run near-unattended (the clone) degrades in exactly the ways the bar forbids.
2. **Every answer-set game keeps a human per puzzle, even with generation.** Spelling Bee, Squaredle and Waffle all say so explicitly, and Squaredle tried fully random generation first and abandoned it. If rhyme-bee goes unattended it is first of its kind, so the Synthetic Player evidence has to carry weight that no precedent can.
3. **The transferable mechanism is the Squaredle default**: when knownness is uncertain, make the word a Bonus Word. It turns a Reachability failure (required word nobody knows) into a harmless one (an unscored find), and it needs no editor at run time. Its cost lands on Trust only if Bonus Words are rejected, which they are not.
4. **A front-loaded list that is edited later must not move the schedule.** Wordle's 2022 desync and the clone's #17 are the same bug as our stale-Rhyme-Key days. Whatever is front-loaded should pin each date to its content, not recompute it.
5. **Rolling, where it exists, means weeks, not a perpetual generator.** The NYT games schedule about three to six weeks ahead, each day signed by an editor. No source found describes a rolling pipeline with no human sign-off.
6. **Repetition is the accepted answer to exhaustion.** Wordle chose to repeat early rather than grow the list, without a fixed minimum gap. Our "at least a year between repeats" is stricter than the industry leader's practice.

## Gaps

- NYT pages were fetched through their public JSON endpoints and quotation in other outlets; nytimes.com articles themselves could not be fetched, so NYT statements here are second-hand except for the API data.
- No first-party statement was found on how far ahead Spelling Bee is built, or on what Semantle did or will do when its shuffled list ends.
- Heardle (shut down by Spotify in May 2023, nine months after purchase) and other acquired games show that Continuity can also end by an owner's choice; not pursued further as it does not bear on word lists.
