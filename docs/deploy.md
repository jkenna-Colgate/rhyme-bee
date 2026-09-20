# Deploying, and the daily refine loop

The game is a static bundle plus a 15 MB Rhyme Index, served by one Cloudflare
Worker that also answers the two reporting endpoints. Judging happens in the
browser, so the deploy is a file upload with a routing table attached — see
[ADR-0013](./adr/0013-adjudication-never-crosses-the-network.md).

| Thing | Value |
|---|---|
| Worker | `bramble-bee` |
| Public URL | `https://bramble-bee.kenna-dev.workers.dev` |
| R2 binding → bucket | `APPEAL_QUEUE` → `rhyme-bee-flags` |
| Worker secret | `GITHUB_ISSUE_TOKEN` |
| Config | `web/wrangler.jsonc`, committed |

## The command

From the repo root:

```
npm run deploy
```

That is: build the index from the pinned sources in `data/`, build the shell
around it, then `wrangler deploy`. The Worker, the bundle and the index go up as
**one version**, which Cloudflare activates in a single step — nobody sees a
half-updated site, and no player ever gets a bundle that names an index the
deploy has not uploaded.

Roughly four minutes, almost all of it the index build — **unless no Rhyme Index
input has changed since the artifact was built, in which case the deploy skips
the rebuild and takes seconds.** It decides that for itself and says which
branch it took; there is deliberately no flag, so there is no fast path to reach
for by mistake. A Seed Word swap edits `data/schedule.json`, which the Index
never reads, and is the case this exists for. The predicate errs toward
rebuilding: a wasted four minutes is visible, and shipping a bundle whose judge
predates the fix it was made for is not.

To see what would be uploaded without uploading it,
`npm run --prefix web deploy:dry-run`.

### Before the first deploy, once

1. `npx wrangler login` in `web/` — the ordinary account login. It grants no R2
   scope, which is why the pull-down script below needs a token of its own.
2. `npx wrangler secret put GITHUB_ISSUE_TOKEN --name bramble-bee`, **in a real
   terminal window**. The command reads the value from stdin and prompts only
   when attached to a terminal; run it anywhere stdin is closed and it uploads an
   empty string and reports success. If you did not see the prompt and type the
   token, it did not work, and the only symptom is an opaque auth failure the
   first time someone files a note. Re-running overwrites, so recovery is doing
   it again properly.
3. `credentials.env` at the repo root, holding the read-only R2 token for
   `npm run appeals:pull`. Git-ignored, and it stays that way.

The `APPEAL_QUEUE` binding does not exist until the first deploy creates it. The
Worker's settings page showing nothing beforehand is expected, not a fault.

### What is not done, deliberately

- **Nothing is built on Cloudflare's infrastructure, and the Worker has no Git
  repository connected for builds.** `data/sources.json` pins cmudict, the word
  list and the names list, and a pinned source re-fetched in a build environment
  is not pinned: upstream edits a pronunciation and the judge changes verdicts
  silently between two deploys, making a player's "this worked yesterday"
  unreproducible. The prevalence norms are additionally licensed for academic use
  and are republished to no public build environment. This machine is the only
  build host, and that is the cost of a reproducible judge.
- **Nothing is bound in the dashboard.** A binding that lives only there is
  clobbered by the next deploy from a config that does not declare it, so
  `web/wrangler.jsonc` is the only home for bindings. Add them there.
- **Both write endpoints are rate limited**, one budget each, keyed on client IP
  and declared as bindings in `web/wrangler.jsonc`. #114 Step 9 decided against a
  limit while the URL was unlisted and the tracker private; publishing the
  repository ended both premises (#213). Counting is per Cloudflare location, so
  the numbers are set to make scripted abuse pointless rather than to meter
  anything exactly.
- **No secret is in the repository.** `GITHUB_ISSUE_TOKEN` is set on the Worker
  and referenced by name. If a credential ever lands in git history, rotate it
  rather than rewriting history.

## What is in the deploy

`web/dist` is the uploaded directory, and it holds only what the running game
needs:

- `index.html` and `assets/*` — the bundle, content-hashed by Vite.
- `index-<hash>.json` — the Rhyme Index, content-addressed, its filename baked
  into the bundle at build time.
- `index.manifest.json` — generated, and unused by the client on purpose. It is
  the upgrade path to a split deploy (ADR-0013), not dead code.
- `_headers` — the cache directives, declared by the deployment rather than
  inherited from host defaults: immutable and long-lived for the hashed index and
  the hashed bundle assets, revalidated for the entry point and the manifest.
- `share/<rank>.html` and `share/<rank>.png` — one landing page and one badge
  per Rank on the ladder, generated at build time (#196). A player shares a Rank
  by sending one of those page URLs; it unfurls into a link card carrying the
  badge. Nothing renders on request and the Worker gains no route: a share page
  the build never wrote — a Rank renamed since the link was sent — falls through
  to the front page in `web/worker/index.ts`.

  The absolute URLs in those pages' Open Graph tags need a hostname, and the
  build takes it from **`SHARE_ORIGIN`**, defaulting to the public URL above.
  Set it if this ever deploys somewhere else; a wrong one is silent, producing a
  card with no badge and no other symptom.

`dist-data/` also accumulates the drop and derivation reports and every probe
script anyone has written while chasing a rhyme bug. **None of that ships.** The
build copies a named list out of `dist-data` rather than the directory
(`web/indexAssetPlugin.ts`), so a probe script written tomorrow is absent from
the deploy by default instead of having to be remembered and excluded.

## The daily refine loop

The playtest's whole point is that a false rejection gets fixed while people are
still playing. Once a day, or whenever the Appeals look worth a look:

```
npm run appeals:pull          # 1. bring down what players Appealed (#120)
npm --prefix web run dev      # 2. judge the Candidate Queue in the Editor's Pass
npm run deploy                # 3. rebuild the index and ship it
```

All three run from the repo root. Step 2 starts `web/`'s dev server without
moving you there, because step 3's `npm run deploy` is the root script that
rebuilds the index — from inside `web/` the same words mean `wrangler deploy`,
which uploads the last build and rebuilds nothing.

1. **Pull.** Players tap "should have counted" on a rejection they were sure
   about; the endpoint writes each report to R2 as one object, and this appends
   the new ones to `data/supplement-candidates.jsonl`. It only reads, and it
   recognises what it has already pulled, so running it twice costs one request
   and appends nothing. It is the one step still on the CLI, deliberately: the
   Editor's Pass has no credentials and makes no network call
   ([ADR-0017](./adr/0017-candidates-are-judged-in-the-editors-pass.md)).
2. **Judge.** The Candidate Queue in the Editor's Pass reads that file and
   cannot tell a pulled record from one the dev feedback button jotted. A
   Candidate whose word already rhymes is shown resolved without a ruling; the
   rest are added, corrected or declined by the gestures the pass already has.
   What an add or a correction writes is a line in the committed pronunciation
   supplement, the permanent override layer
   ([ADR-0009](./adr/0009-pronunciation-supplement-is-the-permanent-override-layer.md)).
   Nothing empties the queue: it stays as the record of what was Appealed and
   when.
3. **Deploy.** Step 3 is the ordinary command; it rebuilds the index from the
   supplement you just edited, so a new judge is a new artifact filename and
   every browser picks it up on the next load without a cache clear.

Commit the supplement edit. It is a hand-authored input, and the index that
shipped is reproducible only from the sources plus that file.

### Why this is safe mid-playtest

**In-flight Sessions heal.** A Session persists the player's raw Submissions and
never their verdicts, and replays them through the current judge when the page
next loads. So a player who was wrongly rejected at breakfast, and who reloads
after you ship the fix, finds the word now counted and their Score corrected —
the fix reaches back into the Session already in progress rather than conflicting
with it. Storing verdicts would have made a refined index and an open Session
contradict each other; not storing them is what makes the daily loop possible at
all.

The corollary is that a *bad* refinement also reaches back, which is what the
rollback below is for.

### One thing that is not a reason to change any of this

The game merely being slow to load is **not** a reversal trigger for ADR-0013 —
and it is the one that will feel like sufficient cause, because it is the
complaint you will actually receive. 15 MB raw, 3.3 MB gzipped, parsed once
behind a loading state. If it hurts on a real device the answers are a Web
Worker, a slimmer serialisation, or brotli, measured on a phone. They are not a
server. What *would* reverse ADR-0013 is written down at the foot of the ADR:
a public launch, a leaderboard, or telemetry becoming necessary.

## Rolling back

A bad refinement mid-playtest must be recoverable in minutes. Every deploy is a
version, so it is one action:

```
npm run --prefix web rollback
```

With no version given, `wrangler rollback` offers the previous version and asks
for confirmation. To go further back, list the recent versions first and name
one:

```
npm run --prefix web deployments        # wrangler deployments list
npx wrangler rollback <version-id> --message "why"
```

Or from the dashboard: **Workers & Pages → `bramble-bee` → Deployments →** the
version you want **→ Rollback**. A version carries the Worker code, the bundle
and the index together, so rolling back restores the judge that shipped with it,
not just the code.

Two things to know before you need this in a hurry:

- **A rollback does not change bindings.** Cloudflare refuses a rollback across a
  version where the bindings changed. If you have just added or removed one in
  `wrangler.jsonc`, the way back is to check out the commit that produced the
  good version and `npm run deploy` from it — slower, because it rebuilds the
  index, but it always works.
- **Rehearse it once, before players are invited.** Deploy twice, roll back to
  the first, confirm the site still loads and serves the earlier index filename,
  then roll forward. Finding out that rollback needs an argument you do not have
  is a thing to do on a quiet afternoon rather than during a playtest.
