# Adjudication never crosses the network

The game ships as a static, client-side artifact. The shell fetches the built
Rhyme Index once, rehydrates it, and every Submission after that is judged in the
browser — instantly, offline, with no request in flight. Hosting is a CDN
(Cloudflare Pages, deployed from the maintainer's machine), not a server.

This is written down now because the playtest makes it load-bearing for the first
time. Until now "no server" was simply the absence of a decision: the engine is
pure, the shell is thin, and nothing had ever been hosted. Putting the game in
front of players surfaces the pressures that argue for a server — a 15 MB index
to parse on a phone, a Reveal the client can read past, rejection telemetry
nobody is collecting — and each of them is a good enough reason on its own to
re-open this. The spec is [issue #113](https://github.com/jkenna-Colgate/rhyme-bee/issues/113).

## The loop is what cannot afford a round trip

The game's core loop is type → enter → verdict, run dozens of times in a single
Session. That is the whole interaction; there is nothing else the player does.

A server puts a network round trip inside it. At 150 ms on good wifi that is
tolerable and merely worse; on a phone on a train it is a broken game, and the
failure is silent and total — the player types a word they are sure about and
nothing happens. Client-side adjudication is not *faster* than the alternative,
it is *categorically* different: it works with the radio off.

The Rhyme Index is the only thing that must arrive over the network, it arrives
once, and it is cacheable forever because it is content-addressed. That is the
whole network story.

## What ships

The index ships **whole** — pronunciations, word list, names, prevalence — as a
single artifact whose filename contains a hash of its contents. Immutable
filename, immutable cache directive, filename baked into the bundle at build
time. The bundle and the index deploy together.

Whole, rather than sliced per Puzzle, because `adjudicate` consults all of it.
Wordhood and names are decided independently of rhyme, and a word that passes
wordhood but has no reading is rejected as `not-a-known-word` rather than
`does-not-rhyme` — the distinction that keeps `nightgowns` from being told it
does not rhyme with `downs`. A slice cannot reproduce that, and false rejections
of exactly that shape are what the playtest exists to find.

## Considered Options

**An always-on adjudication server.** Rejected. It buys three real things — a
trivial client payload, an index refreshable without a client deploy, and a
Reveal that is actually enforced — and pays for them with a round trip in the
core loop. The second of those three is available statically: content-addressing
the artifact makes "refine the judge" a file upload plus a deploy, with an atomic
swap and a one-click rollback. Trading offline play for the remaining two is not
a trade this game can make.

**Serverless adjudication.** Rejected, and worse than the always-on version
specifically here. The index is a 15 MB single-line JSON artifact; every cold
start pays to parse it. Cloudflare Workers cannot hold it in 128 MB, and a Lambda
would eat seconds on the first request after idle — which, with a handful of
players opening the game once a day, is *most* requests. The deployment shape
that makes servers cheap is the one this workload is worst suited to.

**Per-Puzzle slices with a compact wordhood filter.** Rejected on fidelity, not
on size. The slice would have to answer "is this a word at all" without
pronunciations, collapsing `not-a-known-word` into `does-not-rhyme`. That is the
precise false-reject that costs a player trust in the judge, traded away to save
about 3 MB on a once-per-deploy download.

**A runtime manifest fetch, so the index can be swapped without redeploying the
bundle.** Deferred, not rejected — this is the **documented upgrade path**. Under
a single deploy the bundle *is* the manifest, so a runtime lookup would add a
blocking round trip before the game could start loading, and a second source of
truth for which artifact is current. The manifest is written by the build and
left inert; it is not dead code. Adopting it later is changing a constant into a
`fetch`, which is why the content-addressed naming — the part that is annoying to
retrofit — is built now.

**Rebuilding the index in CI.** Rejected. `data/sources.json` pins cmudict, the
word list and the names list, and a pinned source re-fetched at build time is not
pinned: upstream changes a pronunciation and the judge changes verdicts silently
between two deploys, making a player's "this worked yesterday" report
unreproducible. Separately, the prevalence norms are licensed for academic use
([ADR-0003](./0003-word-prevalence-not-corpus-frequency.md)) — using them is not
republishing them, so they go into no public repository or bucket. A **private**
source mirror with checksums is the way to make the build reproducible off the
maintainer's machine, and is worth doing on its own merits; it is not on the
playtest's critical path.

**Committing the built index so CI can deploy it.** Rejected. The artifact is one
line, so delta compression has nothing to work with and each rebuild adds roughly
a full compressed copy to history, permanently, paid by every clone and every
worktree agent — against a stated intent to rebuild continuously during the
playtest. It also buys less than it appears to: CI still could not *build* the
index, only copy one the maintainer had already built. Provenance and rollback,
the genuine benefits, come instead from content-addressed artifacts published
outside git.

**GitHub Pages.** Rejected. Gzip only, where the artifact is large enough for
brotli to matter, and awkward precisely because the artifact is not in git.

## Consequences

- **The Reveal is a convention, not an enforcement.** CONTEXT.md defines the
  Reveal as a give-up gate whose whole purpose is that Rank stays honest — and
  the entire answer set is in the player's browser, readable from developer
  tools. This is knowingly accepted for a friends-and-family playtest. The
  client-side half that *is* enforceable must still be built: a Session snapshot
  records that the Reveal was taken, so reloading cannot un-end a Session and
  hand the player the answer sheet.
- **No adjudication telemetry.** Nothing observes what players submit, so
  everything known about false rejections arrives because a player chose to
  report it. This is why the one-tap should-have-counted control is not a
  nice-to-have: it is the only sensor.
- **Reporting is out-of-band, and may fail freely.** Both report endpoints are
  Pages Functions sitting outside the loop. Exhausting the free request budget,
  or taking them down entirely, degrades reporting only — the game keeps playing,
  because judging is local. Untrusted payloads are validated in the pure modules
  that own each record, and the closed rejection reason set
  ([ADR-0005](./0005-input-is-never-silently-transformed.md)) makes that
  validation exhaustive by construction.
- **Session state is client-side, so its format is the engine's business.** What
  persists is the raw Submissions, replayed through the current judge on restore
  — never stored verdicts, which would let a stale Session contradict a rebuilt
  index. A useful side effect: the snapshot format lives in the engine, so a
  reported Session can be rehydrated by a script and replayed against a rebuilt
  index to reproduce a complaint exactly.
- **"Today" is the player's local calendar date.** With no server there is no
  authoritative clock, and local rollover is what every daily puzzle a player has
  met already does. A fixed anchor zone is the right answer the moment scores are
  compared across players.
- **First-load cost is a real risk and its fix is not a server.** 15 MB raw,
  3.3 MB gzipped, parsed and rehydrated into Maps and Sets of some 600k entries
  behind a loading state. If that hurts on a real device, the answers are a Web
  Worker, a slimmer serialisation, or brotli — measured on a phone, not guessed
  at here.
- **The maintainer's machine is the only build host.** Sources are not in git and
  must not be republished, so no CI job and no other agent can produce a
  deployable index. That is a single point of failure, mitigated by the private
  mirror above, and it is the reason the deploy is a laptop command rather than a
  push.

## What would reverse this

Any one of these, and the argument above stops holding:

- **A public launch**, where players are strangers rather than friends and the
  Reveal's integrity stops being a convention that everyone is happy to honour.
- **A leaderboard or any cross-player comparison**, which needs both an
  authoritative clock (flipping the rollover to a fixed anchor zone) and a Score
  the client cannot fabricate.
- **Adjudication telemetry becoming necessary** — if the volume of play is high
  enough that voluntary reports are a biased trickle, the submissions have to be
  observed rather than reported.

None of these is reached by the game merely being slow to load. That is the
reversal to watch for, because it is the one that will feel justified.
