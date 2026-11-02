# The unattended loop calls a model in one place, and the Playability Bar does not depend on it

**Status:** amended 2026-10-26 and 2026-11-02. A Batch no longer counts a rare Bonus Word as a Trust failure, puts the Judge's undecided rhymes to the maintainer in the same sitting, and sends the Judge Answers that only Normalisation puts on the Rhyme Key (decided, not built). The one job that calls a model still judges Appeals and nothing else, and Trust and No False Accepts are still checked only in Batches. What its writes reach players by changed: CI builds the index from a private source mirror and deploys on every push to main, and one monthly workflow judges Appeals, runs the Tier moves, commits its report and deploys, with the Appeals step free to fail without stopping the rest.

The two parts of the Playability Bar that need a model, Trust and No False
Accepts, are checked by the maintainer in **Batches** before they leave, and by
nothing afterwards. Once the game runs with nobody attending, exactly one job
calls a model: on a timer, it gives the Appeals players have sent to the judge.
That job may stop at any time. When it does, Appeals pile up and the game is no
worse than the last Batch left it.

This is decided here and not yet built. It was settled in
[Front-load or rolling: does the unattended loop call an LLM?](https://github.com/jkenna-Colgate/rhyme-bee/issues/227),
one ticket of the effort to run the game unattended
([#218](https://github.com/jkenna-Colgate/rhyme-bee/issues/218)).

## Why the night before buys nothing

A Puzzle is fixed by its Seed Word and the Rhyme Index. The schedule's 260 days
sit on 260 different Rhyme Keys, and a correction lands on one Rhyme Key, so
nothing played or fixed between now and a Seed Word's date changes what the
gates would find on it. Running them the night before gives the same result as
running them months ahead.

What the night before adds is three things that must all be alive on every
night of the year, with nobody to see a miss: a credential, GitHub's timer and a
model ID. A gate job that stops ships Puzzles nobody checked, which is a
Playability Bar failure nobody sees.

So "before each date" in
[What number passes each part of the Playability Bar, and what measures it?](https://github.com/jkenna-Colgate/rhyme-bee/issues/225)
reads as "in a Batch, at some time before the date".

## Why Batches, and not one pass over the pool

One pass was the first recommendation, and the maintainer overturned it on two
grounds.

**The subscription cannot carry the pool in one sitting.** A Batch of 30 Seed
Words at three looks each is about 90 calls plus the judge. The largest sitting
so far was 65 calls. The pool is 259 Seed Words, so about nine Batches.

**A Batch measures the instruments as well as the Puzzles.** A correction
teaches nothing about another day. But a month of days that have been tested,
judged and fixed says how good the Synthetic Player, the judge and the Trust
settings are, and that carries to every later Batch. Running one Batch again
shortens that loop to a sitting, and it is where a stronger model can be tried
as the Synthetic Player.

The Synthetic Player's model is therefore a setting. It starts at Sonnet. Haiku
runs are dropped: Haiku submits half as many words and its finds do not fall
from run to run, so a quiet Haiku run says little.

## Why Appeals are the one exception

An Appeal is the only evidence that cannot be gathered ahead, because it does
not exist until somebody plays. And players find what the instrument does not.
On the 22 Seed Words that have both Appeals and saved Synthetic Player runs,
those runs produced 23 of the 57 Appealed word-list words that had no reading.
Most of those Seed Words had a single Sonnet run and a Batch takes more, so 23
of 57 is a low estimate of what a Batch catches, and still well short of all.

Left unjudged, every turn of a Seed Word replays the same refusals.
[ADR-0017](./0017-candidates-are-judged-in-the-editors-pass.md) already said why
that is not a safe default: a pass that is never made is a queue that grows.
With the maintainer attending, 109 of the 189 Candidates pulled by 2026-09-28
were still word-list words with no reading on the index of 2026-09-20.

A fix is first met on the Seed Word's next turn, at least a year on. So how
often the job runs makes no difference to a player, and its period is set by
what keeps the job alive.

## The job

- **A timer, with the period as a setting.** It starts at one month and stays
  under 60 days, because GitHub switches off a scheduled workflow in a public
  repository after 60 days with no repository activity.
- **The maintainer's subscription token** (`claude setup-token`). No bill. It
  lasts one year.
- **One fixed model**, the one the judge was measured on. When that model is
  retired the job stops.
- **A run report, committed by every run:** the date, the Appeals judged, the
  rulings written and the model used. A run that cannot reach the model fails,
  so GitHub emails the workflow's owner. There is no other alarm, since a
  stopped job asks nothing of anyone.
- **A limit on Appeals judged per run, as a setting.** Anyone can send an
  Appeal, and each one judged spends the maintainer's plan.
- **The model step never blocks the work that has no model in it** (the Tier
  moves, the Continuity repair, the rebuild and the deploy).

The token and the model each last about a year. One optional sitting a year
renews the first and moves the second. Like the Editor's Pass, it lifts the game
and the Playability Bar does not wait for it.

## Considered options

- **Rolling gates: a job checks each Puzzle shortly before its date.** The same
  calls and the same answers as a Batch, and 260 nights a year on which it can
  fail unseen.
- **A job runs the later Batches once the instruments are tuned.** It would let
  the maintainer leave sooner. Rejected because a stopped job is a Playability
  Bar failure nobody sees, and nine sittings is not many.
- **Appeals pile up unread.** Simplest, and every turn of a Seed Word then
  replays the same refusals for good.
- **Appeals judged every day.** Nothing more for a player, since the Seed Word
  is a year from returning, and thirty times the chances to fail.
- **Appeals judged once, just before a re-deal.** It cannot outlast the 60-day
  rule, and one failed run costs a year.
- **A paid API key with auto-reload.** It runs with no touch. Rejected because
  the bill is then set by strangers and the job is not load-bearing. Prepaid
  credits without auto-reload also expire after a year, so they are no better
  than the token.
- **A model alias, alone or with a test against the labelled pairs before each
  run.** The job would outlive a retirement. Rejected because a stopped job is
  harmless and a wrong judge is not: an alias has a judge nobody measured
  writing readings nobody reviews. If the job must one day run untouched for
  years, the pair to pick is the paid key with the alias and the test.

## Consequences

- **A gate is not run again once the maintainer has left.** A Tier move from
  Session Records, a reading from a judged Appeal and a Continuity repair each
  change a Puzzle that already passed, and nothing checks Trust on it again. A
  change that reshapes Puzzles (a new size band, a re-deal that brings in a Seed
  Word no Batch has seen) is one the maintainer steers, with a Batch after it.
  What a re-deal may do with nobody there belongs to
  [When the schedule runs out, how is the next cycle dealt?](https://github.com/jkenna-Colgate/rhyme-bee/issues/228).
- **With nobody there the pool cannot grow.** A new Seed Word needs a Batch
  before it gets a date.
- **A day that arrives before its Batch ships as it does today.** Batches go in
  date order, soonest first, and the Seed Words already played go last, before
  the schedule ends on 2027-04-19.
- **The job judges Candidates outside the Editor's Pass, which ADR-0017 does not
  provide for.** What the job may write, and the amendments to ADR-0017 and
  [ADR-0011](./0011-reading-manufacture-is-frozen.md) that follow, belong to
  [How do a judge's corrections land with nobody reviewing them?](https://github.com/jkenna-Colgate/rhyme-bee/issues/238).
  This record settles only that the job exists, when it runs and with what.
- **The job needs two secrets:** the Claude token, and the read-only R2 token
  for the pull that ADR-0017 kept on the CLI.
- **[ADR-0013](./0013-adjudication-never-crosses-the-network.md) is untouched.**
  The job asks for no verdict on a Session and reports nothing to the player who
  Appealed.

Three things were not measured: how many calls the subscription allows in one
sitting, what an Opus run costs, and whether a report commit counts as the
repository activity GitHub's 60-day rule asks for.

## Amendment (2026-10-26): how the jobs reach players

Settled in
[Where does the job with no model in it rebuild and deploy, when ADR-0013 keeps the index build off CI?](https://github.com/jkenna-Colgate/rhyme-bee/issues/255).
Three consequences above change.

- **[ADR-0013](./0013-adjudication-never-crosses-the-network.md) is amended,
  not untouched.** Its verdicts still never cross the network. What changed is
  that CI now builds the index from a private source mirror and deploys on every
  push to main, so what the jobs write reaches players with nobody there.
- **One scheduled workflow, made of separate commands.** Each run pulls and
  judges Appeals, then runs the Tier moves, then commits the run report, then
  calls the same deploy a push to main runs. The Appeals step may fail and the
  rest still runs. Each command also runs by hand.
- **Three secrets, not two:** the Claude token, the read-only R2 token (which
  now also reads the source mirror), and a Cloudflare token scoped to deploying
  the Worker. The last two are created with no expiry, so when the Claude token
  runs out only the Appeals step stops.
- **The 60-day rule is met two ways at once.** The run report is committed, and
  each run also calls GitHub's enable-workflow API on itself, the method
  keepalive projects use. Neither is documented to count. A throwaway public
  repository with no other activity tests both, and nothing waits on its answer:
  a job that stops leaves the game at the bar, and the deploy on push keeps
  working.

## Amendment (2026-11-02): what a Batch counts, and what it puts to the maintainer

Settled in a review of the second Batch (2026-11-02 to 2026-12-01: 19 days
passed Trust, 10 failed, 1 untested). Batches stay where this ADR put them:
run by the maintainer, and the only check on Trust and No False Accepts. What
changes is what a look counts, what the sitting asks of the maintainer, and
what the No False Accepts hunt sends. It is decided and not built.

- **A rare Bonus Word is no Trust failure.** A look used to count every
  rhyme the game did not score as an Answer, so `hod`, `pard` and `hawse`
  failed their days in every look while the game accepted them as the Bonus
  Words they are. Whether a word scores is its Tier's question
  ([ADR-0015](./0015-tier-overrides-record-retrieval-not-recognition.md)), not
  Trust's. Now a rhyme the game accepts as a Bonus Word is not counted when its
  knownness measures it as rare. One with no knownness at all still counts,
  because that is the only way a common word (`fool` for `cool`) ends up a
  Bonus Word by accident, and the maintainer ruled that one a Trust failure.
  Counting it costs noise and nothing more, since a failing day still ships.
  Against this Batch, 4 of the 10 failed days pass. Not counting unmeasured
  words either would have passed 8, and was rejected for the `fool` case.
- **The sitting puts to the maintainer what it would otherwise leave
  behind.** Seven of this Batch's Judge rulings said Rhyme and landed nothing,
  most of them medium-confidence Overrules (`house` and `douse` for `arouse`,
  `bras` for `cause`). That is by design, since an Overrule loses a confidence
  level, but nothing put them in front of anyone. Now the ruling list shows
  every such ruling in the same sitting. Two other routes were considered:
  making a medium Overrule an Unconfirmed Rhyme (rejected, because the lost
  level was measured against the maintainer's rulings), and the Editor's Pass
  (rejected, because the maintainer would read the same words later instead of
  now). [ADR-0017](./0017-candidates-are-judged-in-the-editors-pass.md) still
  governs Appeals. The list also asks the maintainer to Tier each word the
  Batch wrote in that has no knownness (25 of 131 this time), with the Judge's
  answer filled in. The Judge's Tier answer lands alone only once it has been
  measured against the maintainer's rulings. And a correction may keep several
  of a word's readings rather than replace them all with one.
- **The No False Accepts hunt sees what Normalisation makes.** The hunt sends
  an Answer to the Judge when its Wiktionary readings miss the Seed Word's
  Rhyme Key. Those readings go through the same Normalisation as the game's
  own, so a false accept that a Normalisation rule makes is confirmed by its
  own rule: `annual` was never sent for `cool`. Now an Answer that reaches the
  key only through a reading Normalisation appended is sent too. Over the whole
  Schedule that is 312 words, none on 175 days. It starts with one trial over
  those 312, compared with the maintainer's rulings, which already say `chess`
  and `event`'s words are false and `shoot`, `lawn` and `hire`'s are not.
