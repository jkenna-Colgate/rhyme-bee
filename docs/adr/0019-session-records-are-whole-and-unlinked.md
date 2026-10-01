# Session Records are sent whole and unlinked

The game sends a **Session Record** for every Daily Puzzle Session: the stored
Session exactly as the browser already keeps it (date, Seed Word and Rhyme Key,
every Submission in order, whether it ended), plus a random id for that one
Session and the content hash of the Rhyme Index that judged it. Nothing in it
says who played, and nothing links one day's record to another day's.

This is decided here and not yet built. It was settled in
[Does live telemetry have a role, and what would it collect?](https://github.com/jkenna-Colgate/rhyme-bee/issues/226),
one ticket of the effort to run the game unattended
([#218](https://github.com/jkenna-Colgate/rhyme-bee/issues/218)).

## Why collect anything

One job justifies it. The Playability Bar's Reachability part says a typical
player reaches Laureate on most days, and the Synthetic Player cannot set that
level: two models disagree by 21 points of Rank and no human data says which is
typical ([#223](https://github.com/jkenna-Colgate/rhyme-bee/issues/223)). Real
Sessions are the only anchor, and with a handful of playtesters nobody is going
to report them by hand.

Two other uses come free from the same record and justify nothing on their own:
rejected Submissions arrive with their words, which is a second Trust sensor
beside the Appeal, and the order of Submissions shows whether a Session stops
right after a genuine rhyme is rejected, which is the only test the
trust-drives-effort hypothesis has.

Watching the bar after the maintainer leaves is **not** a use. Nobody will be
reading, and the unattended loop does not tune itself from these records. They
are read once, on an optional return visit, to set Reachability's level.

## Why there is no player identifier

A random per-browser id was the first recommendation and was withdrawn. The
argument for it was that one keen player would swamp a pooled figure. Within a
date that cannot happen: a browser holds one Session per date, so every record
for a given day is a different player.

What an id would add is the per-person reading of Reachability (each player
reaches Laureate on most of the days they play). The per-day reading (on most
days, the typical Session reaches Laureate) needs no id, and it is the better
reading for this game: Difficulty is meant to climb from Monday to Sunday
(ADR-0007), so a per-person figure would mostly measure which weekdays someone
happens to play.

Against that, an id turns "someone tried these words on this date" into one
person's whole history, among players the maintainer knows by name. It is also
the irreversible direction. Browsers keep every past Session, so an id can be
added later and the history sent again. Linked histories cannot be un-collected.

The per-Session id links nothing. It exists so a Session sent twice, as it grows
through the day, replaces its earlier copy.

## Considered Options

**No collection.** Rejected. Reachability would have no level, or one borrowed
from whichever model was run last.

**A computed summary** (final Rank, Answer count, rejection count). Rejected. It
is frozen to the questions asked on the day and to the index of the day. It
cannot say where a player's gap to Laureate lives or which words were refused,
and it cannot use the Sessions already sitting in browsers.

**One event per Submission, with timestamps.** Rejected as more than the job
needs: a request per Submission and a new format, to buy dwell time nobody has
asked for. Order is enough for the effort hypothesis.

**A per-browser identifier.** Rejected, above.

**An ordinal in place of an id** ("this is my Nth Session"). Rejected.
Consecutive ordinals on consecutive dates re-link a heavy player by inference,
so it costs complexity and buys little privacy.

**Free Play Sessions too.** Rejected. They are never stored, so collecting them
is a second path for data the bar does not ask about.

**An in-game notice, a consent banner or an opt-out.** Not now. See the last
section for what brings them back.

## Consequences

- **Reachability can only be stated per day.** A pass line of the form "half of
  players reach Laureate on most of their days" cannot be computed from these
  records. Whether the line is flat across the week or scaled to the weekday is
  left to the ticket that sets the bar's numbers; the weekday is already in the
  date, so either costs the record nothing.
- **Sending is one rule.** On load and when the page is hidden, the browser
  sends every stored Session that is new or has grown since it was last sent.
  That covers today's Session, a visitor who never returns, and a refresh.
- **History arrives on the first visit.** No code has ever deleted a stored
  Session, so each playtester's browser holds every Daily Puzzle played since
  2026-08-06 and sends them all once. Those Sessions carry no index hash, so a
  replay shows what the current index would say and not exactly what the player
  saw. They were also played before Trust holds, and may understate
  Reachability; the date on each lets a reader set them aside.
- **It is reporting, so it may fail freely.** A third Worker route with its own
  rate limiter writes to the private bucket that holds Appeals, under its own
  prefix. If the route is down or over budget the game plays on and the record
  is lost (ADR-0013). Records are pulled to the maintainer's machine, are never
  committed, and are kept indefinitely because nobody will be there to prune
  them.
- **No IP address is stored**, as before. It is read for the rate limiter and
  dropped. Submissions that are oversized or not word-shaped are refused, so a
  stray paste into the box is not kept.
- **A dev build sends nothing.** That is where the maintainer plays, after
  reading the day's Answers in the Editor's Pass, and those Sessions would
  inflate the figure with no way to pick them out afterwards.
- **Disclosure is a README section**, "What the game records", listing the
  fields and what is not collected. The sentence "Nothing observes what players
  submit" in ADR-0013 and in `web/src/PuzzleView.tsx` stops being true the day
  this ships and is corrected with it.

## What would reverse this

- **Players the maintainer does not know, players outside the US, or children
  under 13.** The choice to disclose in the README alone rests on all three
  being absent: no identifying data, a non-commercial game, and a few known
  adults in one country. Before any of them changes, add an in-game notice and
  an opt-out.
- **A need for the per-person reading of Reachability.** Add a per-browser id
  then, with the notice above, and resend the history.
- **A leaderboard or any cross-player comparison**, which ADR-0013 already
  names as its own reversal and which needs identity of a different kind.
