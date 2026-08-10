# The Editor's Pass, end to end

Walk this once, by hand, to see the whole loop: read tomorrow's Daily Puzzle,
add a word the read turns up as missing, ship it, and watch it land in the live
game. Every command below is real, every output shown was captured from a real
run, and every step that writes something says how to undo it.

The pass is meant to be run the night before a date goes live, so nothing it
finds is ever urgent. Budget about ten minutes plus a four-minute index rebuild
in step 7.

| What it writes | Where | Undo |
|---|---|---|
| accepted readings | `data/supplement.dict` | `git checkout -- data/` |
| words it could not resolve | `data/deferred-readings.jsonl` | `git checkout -- data/` |
| nothing at all | steps 1, 2, 8 | — |

Only step 6 (the commit) and step 7 (the deploy) leave this machine.

## Before you start

- Be on an up-to-date `main` with `data/` clean — `git status --porcelain`
  should show nothing under `data/`. You will be reverting into that state at
  the end, so it wants to be the state you began from.
- A built Rhyme Index must exist in `dist-data/`. Step 1 needs it to resolve the
  scheduled Seed Word; if it is missing you are told to run `npm run build:index`
  from the repo root.
- `npx wrangler login` only matters at step 7. Steps 1–5 touch no network except
  the optional agent call in step 3.

### PowerShell eats the `--` separator, and fails silently

**Read this before typing any command with a flag on it.** In PowerShell a bare
`--` is consumed by PowerShell itself and never reaches npm. npm then treats
what follows as its own configuration rather than as arguments for the script,
and forwards it nowhere. Nothing warns you:

```
npm run editor:read -- --date=2026-08-20        # BROKEN: silently reads tomorrow
```

That runs `tsx scripts/editor.ts read` with no arguments at all. The date is
gone and the readout looks perfectly normal — it is simply the wrong day.

The space form is worse, because it half-works:

```
npm run editor:read -- --date 2026-08-20        # right day, wrong reason
```

npm swallows `--date` as configuration and passes the leftover `2026-08-20`
through as a bare positional, which the parser happens to accept as a date. You
get the day you asked for by luck. The luck runs out as soon as there are two
flags:

```
npm run editor:add -- --words=earache --rhymeKey="EY K"    # BROKEN
```

Both flag names are swallowed and only their values survive, as bare
positionals: `add earache EY K`. Bare positionals on `add` are *words*, so this
tries to add three words — `earache`, `EY` and `K` — against **tomorrow's**
Rhyme Key, silently ignoring the key you named.

**Two forms that always work, in PowerShell and in Git Bash alike.** Invoke tsx
directly — no separator to lose, and shorter to type:

```
npx tsx scripts/editor.ts read --date 2026-08-20
```

Or keep the npm script and quote the separator, which is what stops PowerShell
eating it:

```
npm run editor:read '--' '--date=2026-08-20'
```

This document uses the `npx tsx` form for every command that takes an argument.
`npm run editor:read` and `npm run deploy` carry no arguments and are safe as
they are.

In Git Bash the bare `--` survives and every form above works. If you are unsure
which shell you are in, the check is free: npm echoes the command it is about to
run, so look for the arguments on the `> tsx scripts/editor.ts …` line. If they
are not there, they did not arrive.

### And quote every comma-separated list

A second, independent PowerShell trap, and the one most likely to bite `add`.
PowerShell reads `a,b,c` as an *array literal* and hands it to the script as one
space-joined argument:

```
npx tsx scripts/editor.ts add --words saltpeter,fleeter      # BROKEN: one word
npx tsx scripts/editor.ts add --words "saltpeter,fleeter"    # two words
```

The unquoted form arrives as the single word `saltpeter fleeter`, which is not a
word and will be deferred or refused. Quoting is the whole fix, and the equals
form does not help — `--words=a,b` is mangled exactly the same way. The summary
line names the count, so `Adding 1 word(s)` when you named two is the tell.

Everything below quotes its comma lists. In Git Bash the quotes are harmless.

## 1. Read tomorrow's Daily Puzzle

```
npm run editor:read
```

With no arguments this reads **tomorrow**, computed from your own local calendar
date — the same date a player's browser will ask for. Run on 2026-08-07 it
prints 2026-08-08:

```
  2026-08-08  Sat  ·  week 1

  Seed Word:  centimeter  —  spoken "SEH-ntuh-mee-tur"
  Rhyme Key:  IY T ER

  Answers 25 (band 20–120)  ·  max Score 195
  Difficulty 0.1590  (Sat band 0.1566–0.1950)
  recorded:  25 Answers  ·  Difficulty 0.1590

  Answers (25)
    anteater    beater      beefeater   browbeater  cheater     completer
    defeater    dieter      eater       greeter     heater      kilometer
    liter       meter       milliliter  millimeter  nanometer   overeater
    peter       repeater    retreater   seedeater   skeeter     teeter
    tweeter

  Bonus Words (17)
    ammeter     centimetre  crabeater   deciliter   demeter     fisheater
    gravimeter  kilometre   metre       millilitre  millimetre  neater
    pieter      praetor     seater      sweeter     treater
```

These figures move with the real date. Read what your run prints rather than
expecting the above.

Five things to check, in the order they appear:

1. **The date and weekday** are tomorrow's, not today's.
2. **The respelling** is how you would say the Seed Word out loud. This is what
   the player hears at the start, and the whole Puzzle is adjudicated against
   it, so a respelling you would not say is a finding in itself.
3. **The Answer count sits inside its size band.** That band is session length,
   not hardness.
4. **The Difficulty sits inside its weekday's band.** The week ramps up, Monday
   easiest to Sunday hardest, so a Saturday band sits high.
5. **`recorded:` matches the two live figures above it.** Those are what the
   schedule was built with; the live ones are what the current Rhyme Index
   actually produces. A gap means the Index has moved since the schedule was
   dealt.

If a figure has left its band you get an explicit block instead of silence:

```
  DRIFTED: Answer count is outside the size band this day was dealt from.
  Band membership is advisory after review (ADR-0012) — this is for your eye.
```

Advisory is the operative word. A drifted day is a day to look at, not a day the
tool will refuse to serve.

### The one failure that must not be skimmed past

If the scheduled Seed Word cannot be pinned to the Rhyme Key the schedule
records, the command exits non-zero with all of it named:

```
  SCHEDULE / INDEX DISAGREEMENT on 2026-08-08 (Sat).
  Seed Word "centimeter" cannot be pinned to IY T ER in the built index.
  …
  A player asking for this date would be handed Free Play instead, silently.
  Fix the schedule entry or rebuild the index (npm run build:index).
```

Reading the day *is* that check — nothing else in the repo performs it. In
production the disagreement is silent: the player is quietly handed Free Play
instead of the Daily Puzzle and has no way to tell.

### Other days, and Seed Words not on the schedule

```
npx tsx scripts/editor.ts read --date 2026-08-20    # a named day
npx tsx scripts/editor.ts read --seed thunder      # audition an unscheduled Seed Word
```

The run currently covers **2026-08-03 to 2027-04-19**, 260 days. Ask for a date
outside it and you are told the range rather than left guessing:

```
No Daily Puzzle scheduled for 2027-05-01. The run covers 2026-08-03 to 2027-04-19.
```

An audition reads a Seed Word that is not scheduled, so a replacement can be
looked at before it is committed to:

```
  audition  ·  not on the schedule

  Seed Word:  thunder  —  spoken "THUH-ndur"
  Rhyme Key:  AH N D ER

  Answers 7 (band 20–120)  ·  max Score 46
  Difficulty 0.1739

  Paste over the four fields of the day you are replacing:
    "seed": "thunder",
    "rhymeKey": "AH N D ER",
    "answerCount": 7,
    "difficulty": 0.1739
```

`thunder` is a good example of why you audition before committing: 7 Answers is
well under the size band's floor of 20, so it would be a very short session. The
pasteable block saves hand-typing a Rhyme Key in ARPAbet and forgetting the
counts beside it — but the paste is yours to make. This does not edit
`data/schedule.json`, which stays a hand-edited, reviewed artifact.

A Seed Word with no pronunciation in the pinned sources cannot be auditioned at
all, and says so: `Cannot pin seed "placeholder": no pronunciation found.`

## 2. Scan the Answers by eye

This is the part no command does for you, and the reason step 1 prints in sorted
columns across the row rather than one word per line: put a third-party rhyme
list up in another window, alphabetical, and run the two lists past each other.

For 2026-08-08 that is a rhyme list for `centimeter` against the 25 Answers
above. What you are hunting is a word that plainly rhymes, that a reasonable
player would try, and that is on neither list here — `saltpeter` is one.

Two things worth knowing while you scan:

- A word in the **Bonus Words** block is already accepted. It rhymes and it is a
  real word; it just scores nothing. It is not missing and needs no add.
- The **Answer / Bonus Word split is about knownness, not correctness.** If a
  word is in the wrong block that is a prevalence question, not something
  `editor:add` fixes.

## 3. Add what the scan turned up

```
npx tsx scripts/editor.ts add --words "saltpeter,streeter,heater,fleeter"
```

You name words and nothing else — never phonemes. With no `--date` the command
aims at tomorrow's Rhyme Key, resolved from the schedule, and says so on the
first line. A night's findings are one command; the words are independent of one
another and their order carries no meaning.

The four words above were chosen to walk every verdict the command can reach:

```
  Adding 4 word(s) against IY T ER  ·  2026-08-08, the centimeter Puzzle

  saltpeter
    composed  S AA1 L T P IY2 T ER0
    from      salt (S AA1 L T) + peter (P IY1 T ER0), the tail taking secondary stress
  streeter
    refused: a Proper Noun stays a Proper Noun, however well it rhymes.
  heater
    refused: a Proper Noun stays a Proper Noun, however well it rhymes.
  fleeter
    composed  F L IY1 T ER0
    from      fleet (F L IY1 T) + er (ER0), the tail taking secondary stress

  2 reading(s) appended to data/supplement.dict.
  Commit it, then npm run deploy — the fix applies to every Puzzle
  the word appears in, and a Session already in progress picks it up.
```

Reading that:

- **`saltpeter` composed.** No reading existed upstream, a compound split
  reached the Rhyme Key, and the reading was verified against `IY T ER` before
  being written. Note `S AA1 L T` and not `S AO1 L T`: this is merged General
  American, and Normalisation has already run.
- **`streeter` refused.** It is in `names.txt`. Refused rather than deferred,
  because deferring says "later" and a name is never.
- **`heater` also refused — and `heater` is an Answer in tomorrow's Puzzle.**
  Some surnames are also ordinary words, and the name check runs before the
  already-reads check, so a word like this reports as a Proper Noun even though
  it is already in the game. Nothing is lost — there was nothing to add — but
  the line reads more alarming than it is. Confirm against the step 1 readout:
  if the word is already listed as an Answer, it is fine.
- **`fleeter` composed** from `fleet` + `er`.

Two verdicts that set did not reach:

- **Already reads on the key** — `already reads on IY T ER — it is in the game
  already, nothing to add.`
- **Reads, but does not rhyme** — reported as a **correction, not an add**, and
  deliberately left for you to make by hand. Overriding an upstream
  pronunciation stays a considered edit to `data/supplement.dict`.

### When no split works: the agent

If no compound split reaches the Rhyme Key, the word goes to an agent to author
a reading, which is then held to exactly the same verification:

```
npx tsx scripts/editor.ts add --words centiliter
```

```
  centiliter
    no compound split reaches IY T ER — asking the agent to author one.
    the agent proposed  S IH1 N T AH0 L IY2 T ER0  — verified against IY T ER.
```

This shells out to the `claude` CLI in headless print mode, on your Pro
subscription — no API key. It is bounded at 60 seconds per word, so a CLI that
hangs on a login prompt costs one word rather than the evening.

**Both agent outcomes are worth exercising.** They are the least-travelled paths
here and the ones a QA pass exists to prove:

- **A reading that fails verification.** Aim a word at a Rhyme Key it cannot
  possibly reach:

  ```
  npx tsx scripts/editor.ts add --words hectoliter --rhymeKey "OW L D ER"
  ```

  ```
    hectoliter
      no compound split reaches OW L D ER — asking the agent to author one.
      the agent proposed  HH EH1 K T OW0 L IY2 D ER0, which does not reach OW L D ER. Deferred.

    1 word(s) appended to data/deferred-readings.jsonl for a later pass.
  ```

  The agent was told the key it had to reach and did not reach it; the reading
  was rejected anyway. Delegating authorship does not lower the bar.

- **No agent at all.** Log the `claude` CLI out, or run with it off `PATH`. The
  word is deferred with reason `agent-unavailable` after at most 60 seconds and
  the command carries on to the next word. A tooling problem is designed to cost
  a few words, not the night.

## 4. Check what was written

```
tail -5 data/supplement.dict
cat data/deferred-readings.jsonl
git status --porcelain data/
```

The supplement gains a section header, written once and reused by later adds,
and one CMUdict-format line per accepted reading:

```
# --- Adds by the Editor's Pass: composed from a compound split and verified
# against the day's Rhyme Key before being written here (ADR-0014). ---
saltpeter S AA1 L T P IY2 T ER0
fleeter F L IY1 T ER0
centiliter S IH1 N T AH0 L IY2 T ER0
```

There is no per-entry comment on purpose: the reason for an add is always the
same one — the word was absent from the pinned sources — so restating it every
line carries no information.

The deferred queue gains one JSON object per line:

```
{"word":"hectoliter","rhymeKey":"OW L D ER","reason":"agent-reading-failed-verification","timestamp":"2026-08-07T20:05:18.132Z"}
```

**This file starts empty.** It was created during development and until a real
pass defers something it is zero bytes, so "does anything actually land here" is
worth confirming rather than assuming. It is the work list for a later pass and
it is what makes the composition's real miss rate countable.

One limit to know before you type a long `--words` list: every word is judged
against a **snapshot** of the evidence taken before the first of them. A word
added by an *earlier* invocation is available as a compound part, but a word
accepted earlier in *this* one is not — `--words=candleholder,candleholders`
cannot use the first to build the second. That wants a second `editor:add`, once
the first has been written.

## 5. Read the day again

Before committing anything, rebuild and re-read. This is the fastest way to see
what an add actually did, and it does not need a deploy:

```
npm run build:index      # about four minutes
npm run editor:read
```

Adding `saltpeter` to the 2026-08-08 Puzzle produces this:

```
  Answers 26 (band 20–120)  ·  max Score 206
  Difficulty 0.2039  (Sat band 0.1566–0.1950)
  recorded:  25 Answers  ·  Difficulty 0.1590

  DRIFTED: Difficulty is outside its weekday's band.
  Band membership is advisory after review (ADR-0012) — this is for your eye.
```

Three things happened, and only the first is obvious:

1. **The word is in.** 25 Answers became 26, and the maximum Score rose from 195
   to 206 — so `saltpeter` tiered as an Answer, not a Bonus Word.
2. **The `recorded:` line now disagrees with the live figures.** Those recorded
   numbers are what the schedule was dealt with, and adding a word does not
   revise them. This is the step-1 check firing for a reason you caused, and it
   is expected here rather than alarming.
3. **The day's Difficulty moved, and left its band.** `saltpeter` is a rare word,
   Difficulty is the share of maximum Score living in rare Answers, and one rare
   Answer on a 25-Answer Puzzle shifted it from 0.1590 to 0.2039 — past the
   Saturday ceiling of 0.1950.

That third one is the thing to take away: **adding a rare word makes a day
harder, not just longer.** Band membership is advisory after review, so nothing
stops you shipping it, and the honest reason to ship it stands — a player who
tries a word that plainly rhymes should not be told no. But if a day drifts hard
after an add, that is the moment to decide, not something to discover on the
day.

## 6. Commit

```
git add data/supplement.dict data/deferred-readings.jsonl
git commit -m "Add the words the 2026-08-08 Editor's Pass turned up"
```

The supplement is a hand-authored input. The Rhyme Index that ships is
reproducible only from the pinned sources plus this file, so an uncommitted
supplement is an index nobody can rebuild.

`data/schedule.json` should be untouched here. If it has changed, something
edited it that should not have.

## 7. Deploy

```
npm run deploy
```

There is one deploy command and no fast-path flag. It decides for itself whether
the Rhyme Index needs rebuilding and says which branch it took:

```
Rebuilding the Rhyme Index: an input is newer than the artifact (data/supplement.dict).
```

A supplement change **does** trigger the rebuild — about four minutes. A
`data/schedule.json` change does not, since the Index never reads it, and that
deploy takes seconds:

```
Skipping the Rhyme Index rebuild: no Index input has changed since it was built.
```

The predicate errs toward rebuilding, so the worst case is a wasted four minutes
rather than a bundle shipping a judge that predates the fix it was made for. The
Worker, the bundle and the index go up as one version.

See [docs/deploy.md](./deploy.md) for the full picture, including
`npm run --prefix web rollback` if what you just shipped was wrong.

## 8. See it land in the live game

Open <https://bramble-bee.jackkenna8.workers.dev> on the date you added against
— or any date whose Puzzle the word rhymes in; a supplement entry is not scoped
to one day.

- Submit the word you added. It should now be accepted rather than rejected.
- **It may land as an Answer or as a Bonus Word, and which one is not up to the
  add.** `editor:add` supplies a pronunciation and nothing else; the tier comes
  from whether `data/prevalence.csv` holds a knownness score for the word.
  `saltpeter` has one, so it arrives as an Answer and the Puzzle's Answer count
  goes from 25 to 26. A word with no prevalence row — `picometer`, say —
  defaults to a Bonus Word, so that a gap in the prevalence data can never
  refuse a real word outright. Step 5 already told you which block your word
  joined; this is where you see it as a player does.
- **Check a Session already in progress.** Have a tab open from before the
  deploy, submit the word and be rejected, then reload after the deploy and
  submit it again. It should be accepted. A Session stores the player's raw
  Submissions and never its verdicts, and replays them through whatever judge is
  current, so a fix reaches back into play already under way. This is the claim
  the add summary makes, and it is the one most worth seeing rather than
  believing.
- If the word is still rejected, hard-reload once. The index filename is
  content-addressed and the bundle names it, so a stale bundle is the only way
  to see the old judge.

## Undoing all of it

Before the commit:

```
git checkout -- data/
```

That restores both `data/supplement.dict` and `data/deferred-readings.jsonl`.
One wrinkle: restoring a file updates its timestamp, so the built Index now
looks stale and your next `npm run deploy` will rebuild for four minutes even
though nothing really changed. Harmless, and worth knowing so it is not a
mystery.

After the commit, `git revert` the commit and deploy again — or, if it is
already live and wrong, `npm run --prefix web rollback`, which restores the
judge that shipped with the previous version rather than just the code.

Steps 1, 2 and 8 write nothing and need no undoing.

## What would count as this pass failing

Worth reporting, in rough order of how much it matters:

- Step 1 exits with `SCHEDULE / INDEX DISAGREEMENT` — a day that would reach
  players as a silent Free Play.
- A word `editor:add` accepted is still rejected in the live game after step 7.
- A word that was rejected mid-Session is still rejected after a reload
  post-deploy — the heal is the load-bearing claim of the whole loop.
- `data/deferred-readings.jsonl` stays empty through a run that reported a
  deferral.
- The agent call hangs past 60 seconds instead of deferring the word.
