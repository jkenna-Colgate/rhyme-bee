# Deploying, and the daily refine loop

The game is a static bundle plus a 15 MB Rhyme Index, served by one Cloudflare
Worker that also answers the three reporting endpoints (an Appeal, a note, and
a Session Record). Judging happens in the
browser, so the deploy is a file upload with a routing table attached — see
[ADR-0013](./adr/0013-adjudication-never-crosses-the-network.md).

| Thing | Value |
|---|---|
| Worker | `bramble-bee` |
| Public URL | `https://bramble-bee.kenna-dev.workers.dev` |
| R2 binding → bucket | `APPEAL_QUEUE` → `rhyme-bee-flags` (Appeals under `flags/`, Session Records under `sessions/`) |
| Rate limiters | `APPEAL_LIMITER`, `FEEDBACK_LIMITER`, `SESSION_RECORD_LIMITER` |
| Worker secret | `GITHUB_ISSUE_TOKEN` |
| Config | `web/wrangler.jsonc`, committed |
| CI workflow | `.github/workflows/deploy.yml` |

## Every push to main deploys

A push to main runs `.github/workflows/deploy.yml` (#273, ADR-0013 amended
2026-10-26). In order: fetch the four sources from the mirror and check them,
`npm run build:index` (which runs the Continuity check and repair), `npm test`,
both typechecks, the web build, then `wrangler deploy`. A step that fails stops
the steps after it, so a failing check leaves the live game as it was. There is
no browser test, deliberately.

- A push that touches only `docs/**` or Markdown files runs nothing.
- The scheduled workflow calls this one with `workflow_call` and
  `secrets: inherit`, because a push made with `GITHUB_TOKEN` starts no other
  workflow. **Run workflow** on the Actions tab (`workflow_dispatch`) runs it by
  hand.
- It always checks out and ships main, whatever started it.
- One deploy runs at a time: a second waits for the first rather than racing it.
- The job summary names the commit and the index filename it built.
- Nothing in it prints a source file or uploads an artifact: the prevalence norms
  are licensed for academic use and a CI log is public.

The deploy step runs only when the repository variable `SETUP_CHECK_PASSED` is
`true`. Until then the workflow runs every check and stops before the deploy
with a notice saying so. The variable records that the setup check below has
passed. It is not a switch to turn off again: ADR-0013 rejected keeping the CI
deploy off, because the unattended deploy would then run for the first time
after the maintainer had left.

### Setting it up, once

1. **Put the sources in the mirror**, if they are not there yet:
   `npm run sources:upload -- data/cmudict.dict data/words.txt data/names.txt data/prevalence.csv`
   from the machine that holds them. The checksums it rewrites should come out
   unchanged; if `git diff data/sources.sha256` shows a change, commit it.
2. **Create a Cloudflare API token** (My Profile → API Tokens → Create Token →
   Custom token) with **Account → Workers Scripts → Edit**, on this account only,
   and **no expiry** (leave the TTL empty). Cloudflare cannot scope a token to
   one Worker, so this account-wide permission is the narrowest there is. If the
   first deploy is refused for a missing permission, add the one it names and
   record it here.
3. **Add four repository secrets** (Settings → Secrets and variables → Actions →
   Secrets):
   - `CLOUDFLARE_API_TOKEN`: the token from step 2.
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`: the read-only
     R2 token, the same three values as `credentials.env`. The account ID is
     also the Cloudflare account the deploy targets.
4. **Run the CI half.** Merge the workflow to main, or press **Run workflow** on
   the Actions tab. The deploy is skipped. Open the run's summary and copy the
   line under "Name the commit and the index built from it": a commit SHA and
   `index-<hash>.json`.
5. **Run the laptop half from the same commit**, in a clean checkout:

   ```
   git fetch origin
   git checkout <sha from step 4>
   npm ci && npm ci --prefix web
   npm run sources:fetch
   npm run build:index
   ls dist-data/index-*.json
   ```

6. **Compare.** If the two filenames are equal, record both on #273, then set
   the repository variable (Settings → Secrets and variables → Actions →
   Variables) `SETUP_CHECK_PASSED` to `true`. The next push to main deploys.
   If they differ, do not set it: find the difference first. The likely causes
   are the Node version (CI pins the laptop's, 22.17.0, in the workflow), line
   endings (`.gitattributes` checks text out as LF on both), CSV parsing and
   sort order.

Check the first deploy from CI: the site loads and serves the index filename
the run named. `npm run --prefix web deployments` lists it as a new version.

## The laptop deploy

`npm run deploy` still works, as the way to ship when Actions is down. Its
build makes the same checksum check against the local sources, so it builds
from the same bytes CI does. From the repo root:

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
   `npm run appeals:pull` and `npm run records:pull`. Git-ignored, and it stays
   that way.

### The index sources

`cmudict.dict`, `words.txt`, `names.txt` and `prevalence.csv` are not in git.
They are mirrored in the private bucket under `sources/`, and their SHA-256s
are committed in `data/sources.sha256` (#272). `npm run build:index` refuses
when a local copy does not match, and names the file.

- `npm run sources:fetch` downloads them, refusing and writing nothing if one
  fails its checksum. It uses the read-only token above, from `credentials.env`
  or the same three environment variables, so CI can run it.
- `npm run sources:upload -- <file>...` uploads a changed source through
  `wrangler r2 object put` and rewrites its checksum. Commit the checksum file
  and push; that commit is what ships the change.

The `APPEAL_QUEUE` binding does not exist until the first deploy creates it. The
Worker's settings page showing nothing beforehand is expected, not a fault.

### What is not done, deliberately

- **Nothing is built on Cloudflare's infrastructure, and the Worker has no Git
  repository connected for builds.** A source re-fetched from upstream in a build
  environment is not pinned: upstream edits a pronunciation and the judge changes
  verdicts silently between two deploys, making a player's "this worked
  yesterday" unreproducible. So the two build hosts, this machine and the GitHub
  workflow above, both build from the private mirror's bytes, checked against the
  committed checksums, and never from upstream. The prevalence norms are
  additionally licensed for academic use, so they sit in the private bucket and
  are never logged or uploaded as a workflow artifact.
- **Nothing is bound in the dashboard.** A binding that lives only there is
  clobbered by the next deploy from a config that does not declare it, so
  `web/wrangler.jsonc` is the only home for bindings. Add them there.
- **No IP address is logged or stored**, although all three write endpoints are
  rate limited by one, the Session Record route included (#230): a Session
  Record carries no IP, no player or browser identifier and no timestamp.
  `CF-Connecting-IP` is read in `worker/http.ts`, handed to
  the limiter and dropped there. #114 Step 9 decided against any limit while the
  URL was unlisted and the tracker private; publishing the repository ended both
  premises, so the budgets exist now (#213) — one per endpoint, declared as
  bindings in `web/wrangler.jsonc` like everything else. Counting is per
  Cloudflare location, so they make scripted abuse pointless rather than meter
  anything exactly.
- **No secret is in the repository.** `GITHUB_ISSUE_TOKEN` is set on the Worker
  and referenced by name. If a credential ever lands in git history, rotate it
  rather than rewriting history.

### Session Records

A production build sends each stored Daily Puzzle Session to
`/api/session-record` on load and when the page is hidden
([ADR-0019](./adr/0019-session-records-are-whole-and-unlinked.md), #230); a
dev build sends nothing. The route writes `sessions/<date>/<id>.json` to the
bucket above, overwriting as a Session grows. They are not part of the refine
loop. Read them when you want them:

```
npm run records:pull     # into data/session-records/, git-ignored, never committed
npm run records:replay   # Rank, Score and each rejection, against the current index
```

`SESSION_RECORD_LIMITER` does not exist until the first deploy after #230
declares it, and that deploy is also what starts the history arriving: each
playtester's browser sends every Daily Puzzle Session it has kept since
2026-08-06 over its next few visits.

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
git commit && git push        # 3. the push to main rebuilds the index and ships it
```

All three run from the repo root. Step 3 ships through the workflow above. When
Actions is down, or before the setup check has passed, `npm run deploy` is step
3 instead: run it from the repo root, because it is the root script that
rebuilds the index. From inside `web/` the same words mean `wrangler deploy`,
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
3. **Deploy.** Committing the supplement edit and pushing it to main is the
   deploy: the workflow rebuilds the index from it, so a new judge is a new
   artifact filename and every browser picks it up on the next load without a
   cache clear. The commit is needed either way. The supplement is a
   hand-authored input, and the index that shipped is reproducible only from the
   sources plus that file.

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
