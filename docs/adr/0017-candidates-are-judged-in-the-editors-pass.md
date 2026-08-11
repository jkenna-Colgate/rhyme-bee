# Candidates are judged in the Editor's Pass, and a correction may join rather than replace

_2026-08-11_

The Candidate Queue becomes a surface inside the Editor's Pass, and the acts an
editor already performs there become the way Candidates are judged. The offline
judging pass — a CLI that prints evidence, a decision tree in a doc, and a hand
edit to `data/supplement.dict` — retires behind it.

This **reverses two decisions that are written down persuasively enough to be
re-derived**, which is the whole reason for a record rather than a diff:

1. That a disagreement over a reading is settled **offline against the queue**
   rather than from a browser. Recorded when the Editor's Pass disagreement path
   was built (#163) and restated in `src/supplementCandidate.ts` — "the judging
   … happens on a later run against the queue" — and in
   `web/src/endpoints.ts`'s note on `APPEAL_PATH`.
2. That a supplement entry **replaces** a word's upstream readings rather than
   appending a variant alongside them, stated as doctrine in `src/supplement.ts`
   and implied by [ADR-0009](./0009-pronunciation-supplement-is-the-permanent-override-layer.md)'s
   "adds and corrections are one mechanism — asserting *an* authoritative
   pronunciation for a word".

Both are superseded **on those narrow points only**.
[ADR-0016](./0016-the-editors-pass-is-a-browser-tool.md) and ADR-0009 are **not
amended**: neither decision is reversed here, and everything else both ADRs say
still stands.

The repository's two earlier reversals are
[ADR-0001](./0001-rhyme-is-the-last-stressed-syllable.md), whose "no
interpretation layer" clause was struck by ADR-0010, and
[ADR-0003](./0003-word-prevalence-not-corpus-frequency.md), whose two open
questions were closed against the real dataset. What both did was leave a **dated
in-place section** in the ADR that moved — ADR-0001's `Amendment (2026-07-29)`,
ADR-0003's `Resolution (2026-07-22)` — so that a reader arriving at the old
decision learns it has moved without having to read forward through every later
ADR to find out. ADR-0016 and ADR-0009 each carry that dated note pointing here.

The note is a **cross-reference, not an amendment**. It withdraws nothing, adds
no consequence, and changes no position either ADR took; it says only that one
narrow point is superseded and where to read the replacement. Superseding
without leaving that trail would make this ADR discoverable only by luck.

## Why the offline pass was right, and why it stopped being

The queue was designed alongside a tool that could not act on it. Judging a
Candidate meant knowing whether the word had a reading, whether that reading
reached the target, and what a defensible correction would be — evidence the
Editor's Pass had no way to gather when the queue was built, and a decision
nobody wanted a browser making. A CLI that printed the evidence and left the
call to a human was the honest shape for that.

Three things changed, and all three are the Editor's Pass itself.

**The tool now gathers exactly that evidence.** `gatherEvidence` answers
wordhood, name status, the word's own readings and its inflectional relatives,
under the same Normalisation the index build applies. The add path calls it on
every word an editor types. Judging a Candidate asks the same question about the
same word against the same target.

**The acts already exist.** The add is `resolveAddOutcome`, aimed at a Rhyme
Key. The demotion is a gesture with the two reasons that decide the player's
message. Verification is `verifyReading`, author-blind (ADR-0014). Nothing in
the judging pass is an act the browser lacks; what it lacked was the list.

**The offline pass does not run.** Thirteen `does-not-rhyme` Candidates stand,
of which five — `talked`, `hawked`, `walked`, `balked`, `stalked`, Appealed
against `docked` — were fixed when the cot–caught merger landed in Normalisation
and have been carried as outstanding work ever since, because clearing the queue
was a manual archive step nobody ran. A pass that is never made is not a
conservative default; it is a queue that grows.

## Resolution is derived, so most of the judging disappears

A Candidate whose word the engine would now accept on its Rhyme Key is
**resolved by that fact alone**. Nothing is written, nothing is moved, and no
archive step exists to forget. A fix landing anywhere else in the build clears
the Candidate the next time the queue is read.

This is what makes the reversal cheap rather than merely convenient. The offline
pass's central cost was that every Candidate needed a human to retire it, and
the derived state removes the human from the majority case entirely — five of
the thirteen on the first render, and every future Candidate that a later
Normalisation rule or supplement entry happens to fix.

The one thing an editor writes that has no other home is a **Decline**
(`src/declines.ts`), keyed on the word and the Rhyme Key together so that
declining a word against one target does not hide it when it is Appealed against
another. Two of the three Declines are not new writes at all: a Proper Noun and
junk-with-wordhood are demotions, and the demotion list already holds exactly the
two reasons that decide what the player is told.

## Why a correction may now join

A supplement entry replaces every upstream reading for its word. That is right
for a genuine correction — an upstream stress that is simply wrong — and wrong
for a word with two legitimate pronunciations, where the new reading should stand
*alongside*. `tear` has both /ɪr/ and /ɛr/, and a correction made for one
accent's sake must not take the other away from the player who has it
(CONTEXT.md, **Rhyme**: a Submission rhymes if *any* of its Rhyme Keys matches).

The supplement can already express this and never has. The CMUdict parser merges
alternate-pronunciation entries into one set, and adjudication already accepts a
Submission that rhymes on any of its Rhyme Keys. So a correction that **joins**
writes both readings as alternates and a correction that **replaces** writes one.
**The merge itself is unchanged and no new syntax is introduced** — which is why
this supersedes a sentence about intent rather than a mechanism.

**Making the supplement append by default is rejected.** Some corrections must
replace: an upstream reading that is simply wrong, left in place, goes on making
words rhyme that should not, silently and forever. The choice is the editor's, on
the approve card, because only the editor knows which of the two situations they
are in — and that is the same argument ADR-0009 makes for the supplement being a
human override rather than a rule.

## What is not reversed

- **The browser still computes nothing.** Resolution needs the pinned sources, so
  the queue's readout is computed in Node and served over a dev-only endpoint,
  exactly as the day's is. ADR-0016's position is unchanged and this slice is one
  more instance of it.
- **Dev-only stays structural.** The queue endpoint is built by the shared editor
  route helper, which declares `apply: "serve"`, so `configureServer` never runs
  in a production build and no Worker route answers the path. ADR-0016's
  consequence holds unweakened, and it matters here for the ordinary reason: the
  slices after this one write to `data/`.
- **[ADR-0013](./0013-adjudication-never-crosses-the-network.md) is untouched.**
  There is no player here and no Session. An Appeal contests a verdict already
  delivered in the player's browser and never asks for one, and nothing in this
  design reports an outcome back to the player who raised it.
- **The R2 pull stays on the CLI.** A button would put credential handling,
  network latency and a new failure mode into a tool whose every other act is
  local. What the screen gets instead is the queue's newest timestamp, so a list
  that is stale because nobody has pulled looks stale rather than empty.
- **The queue file is never emptied.** It becomes an append-only record, which is
  what the idempotent pull already treats it as. The archived-queue file retires
  with the CLI: derived resolution removes the only reason archiving existed.
- **The demotion list's remit does not widen.** It is deliberately bounded and
  hand-curated (ADR-0011's amendment, `src/demotions.ts`), and declining
  Candidates as Proper Nouns must not turn it into a general names filter. If the
  Declines being recorded suggest the names filter is wrong, that is a
  measurement rather than an edit.

## Consequences

- **The state a Candidate is in is derived in one place.** A closed union —
  resolved, declined, addable, needs-correction, is-a-name — returned by one
  function that takes the queue, the schedule, the standing Declines and an
  evidence context as arguments. Without it the resolved check lands in the view,
  the Decline lookup lands in the endpoint, and the add-versus-correct
  determination lands in both.
- **The day panel is a filter, not a second delivery.** A fact about Candidates is
  not a fact about the day, and the day readout's three-variant union — consumed
  by the Tier re-tiering, the Corrected Day and the day view — does not grow.
- **The agent seam narrows to the evidence record.** A correction needs the
  existing reading, which would invite a third parameter; the evidence record
  already carries the word, the target, the readings, the relatives, wordhood and
  name status, so two parameters become one carrying strictly more.
- **Retirement is sequenced, not simultaneous** — the sequencing ADR-0016's own
  CLI retirement uses. The judging script and its doc keep working until the
  browser covers the pass.
- **`Decline` and `reject` are distinct terms.** The engine *rejects* a
  Submission mid-play from index state; an editor *declines* a Candidate
  afterwards by changing that state. CONTEXT.md carries both, so they cannot
  collapse in the tool's copy.
