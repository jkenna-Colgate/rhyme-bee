# What breaks in the deployed game when nobody attends it?

Research for [What breaks in the deployed game when nobody attends it?](https://github.com/jkenna-Colgate/rhyme-bee/issues/243),
on the map [Wayfinder: run the game unattended at a Playability Bar](https://github.com/jkenna-Colgate/rhyme-bee/issues/218).
Primary sources (Cloudflare, GitHub, Node.js and Claude Code docs) plus the local
repo, as of 2026-10-22. Today's use was measured with read-only `wrangler`, `gh`
and `curl` calls; nothing was written to Cloudflare or GitHub. Facts only: what
to do about each row is a later ticket.

## The answer in brief

- **The game itself is the hardiest part.** Assets are served before the Worker
  runs and do not count toward any Workers limit, judging happens in the
  browser, and Cloudflare says old compatibility dates are supported forever. No
  Cloudflare limit is within orders of magnitude of today's use.
- **What breaks first is what the repo itself carries, and dates.** In order:
  1. **Stale Rhyme Keys in the deployed Schedule:** the next day served as Free
     Play instead of its Daily Puzzle is **2026-11-13** (`cool`), 22 days from
     now, then 2027-02-28, 2027-03-07, 2027-04-15 and 2027-04-19. This is
     [Nine scheduled days carry a stale Rhyme Key and fall back to Free Play](https://github.com/jkenna-Colgate/rhyme-bee/issues/151),
     still open, and the deployed bundle carries it.
  2. **The feedback token, `GITHUB_ISSUE_TOKEN`:** expiry not readable from
     here. If it was minted with the 90 days the setup ticket suggested, it
     expires **on or about 2026-11-03**, 12 days from now. After that every note
     a player files fails, the player is shown the error, and the maintainer is
     told nothing.
  3. **The deployed Schedule runs out on 2027-04-19.** The lookup in the
     deployed code is by exact date, so from **2027-04-20** (180 days from now)
     every player gets Free Play every day. The decision that the Schedule loops
     ([When the schedule runs out, how is the next cycle dealt?](https://github.com/jkenna-Colgate/rhyme-bee/issues/228))
     is recorded but not implemented: `seedForDate` in `src/schedule.ts` is
     still a `find` on `date`.
  4. **For the jobs not yet built:** Node 22 leaves support on 2027-04-30, the
     Claude token lasts one year from minting, and Sonnet 5.5 is retired no
     sooner than 2027-09-28. The 60-day Actions rule does not bite today because
     no workflow exists.
- **Open question the docs do not settle:** whether a commit pushed by the
  scheduled workflow itself counts as "repository activity". GitHub's docs use
  the phrase and never define it. Only a test answers it.

## The table

"Unattended" counts from today, 2026-10-22, with nobody deploying, renewing or
re-enabling anything.

| Dependency | Limit or expiry | What reaching it does | Today's use, or how to measure it | Runs unattended until |
| --- | --- | --- | --- | --- |
| **Deployed Schedule data** (not an outside service) | Nine scheduled days carry a Rhyme Key the deployed index does not produce ([Nine scheduled days carry a stale Rhyme Key and fall back to Free Play](https://github.com/jkenna-Colgate/rhyme-bee/issues/151)). Five are still ahead: 2026-11-13, 2027-02-28, 2027-03-07, 2027-04-15, 2027-04-19. | **Player sees it, quietly:** the day opens as Free Play rather than the Daily Puzzle, and its Session is not kept. No alarm anywhere. | `data/schedule.json` on `main` last changed 2026-09-04; it still holds `UW AH L` for `cool` on 2026-11-13. The live index is the one built 2026-09-20 (`/index.manifest.json` on the live site returns hash `b2d5ee6d53dbcdba`). | **2026-11-13** (22 days) |
| **Deployed Schedule length** (not an outside service) | 260 days, 2026-08-03 to 2027-04-19. `seedForDate` returns null for any date not in the list (`src/schedule.ts:229`). | **Player sees it:** from 2027-04-20 every visit is Free Play, every day. Continuity fails outright. The looping Schedule is decided (ADR-0012, amended for [When the schedule runs out, how is the next cycle dealt?](https://github.com/jkenna-Colgate/rhyme-bee/issues/228)) but the code on `main` does not loop yet. | 260 entries in `data/schedule.json`, last `2027-04-19 smile`. | **2027-04-20** (180 days) |
| **Feedback token** `GITHUB_ISSUE_TOKEN` (fine-grained PAT, Issues read/write on this repo only) | The expiry set at creation. The setup steps said "90 days is reasonable" ([Stand up the Cloudflare Worker, R2 bucket and scoped token for the playtest](https://github.com/jkenna-Colgate/rhyme-bee/issues/114), Step 6), and that ticket closed 2026-08-06. GitHub: "Upon reaching your token's expiration date, the token is automatically revoked" and cannot be restored ([token expiration and revocation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation)). GitHub also revokes a PAT unused for a year (same page). Fine-grained tokens may be set to never expire unless an org policy forbids it ([managing PATs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)). | **Player sees an error, maintainer sees nothing:** the route returns 502 with "The tracker rejected the reporting credential (401): it is empty, invalid or expired." (`web/worker/feedbackRoute.ts`), and the feedback panel shows it. No issue is filed, so nothing reaches the tracker. The game is unaffected. | Expiry cannot be read from here: the secret's value is hidden (`wrangler secret list --name bramble-bee` shows only that it exists). Read it at github.com/settings/personal-access-tokens. Last note filed through it: 2026-09-23 (`gh issue list --label feedback --state all`), so it worked then. | **On or about 2026-11-03** (12 days) if 90 days was chosen; unknown otherwise |
| **GitHub REST API limits** for the feedback route | 5,000 requests per hour for a PAT; secondary limits of 80 content-creating requests per minute and 500 per hour ([REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)). Exceeding gives 403 or 429, and "continuing to make requests while you are rate limited may result in the banning of your integration". | Player sees "The tracker refused this note (403)" or (429). | `FEEDBACK_LIMITER` allows 5 per 60 s per Cloudflare location, so 300 per hour per location. A flood reaching two or more locations could pass 500 per hour. Real use: 3 notes filed from the deployed game since 2026-08-10. | No date: breaks only under abuse |
| **Cloudflare Workers, free plan** (requests) | 100,000 Worker requests per day, reset at midnight UTC ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)). "Requests to static assets are free and unlimited" and "Only requests that hit a Worker will count against your limits" ([Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)). Assets are matched before the Worker runs ([Worker script routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)). | Over the limit, Worker requests get Error 1027 (or bypass the Worker, if the route fails open). Only the Appeal and feedback routes and the missing-share-page fallback run the Worker here, so a player loses Appeals and notes, and the game loads and plays as before. | 120 Worker requests in the 30 days 2026-09-22 to 2026-10-21, on 9 of those days, never more than 20 in a day (Cloudflare GraphQL `workersInvocationsAdaptive`). Asset traffic is not counted and was not measured: see the dashboard, Workers & Pages, `bramble-bee`, Metrics. | No date: about 5,000 times today's peak day |
| **Cloudflare Workers, free plan** (CPU and size) | 10 ms CPU per request; 128 MB memory; 50 subrequests; 64 MiB Worker; 20,000 asset files per version; **25 MiB per asset file** ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)). | CPU or memory over: Error 1102 on that request. A per-file size over the limit fails at deploy, and the version already live keeps serving. | CPU p99 at most 2.2 ms per day over the same 30 days, 0 errors. 26 asset files. The Rhyme Index artifact is 14.3 MiB (`dist-data/index-b2d5ee6d53dbcdba.json`), so 10.7 MiB below the per-file limit. | No date for the running game. The 25 MiB file limit binds only on a deploy whose index has grown 75% |
| **R2 bucket `rhyme-bee-flags`** | Free tier: 10 GB-month storage, 1 million Class A (writes, lists) and 10 million Class B (reads) operations a month. Over that, usage is billed: $0.015 per GB-month, $4.50 per million Class A ([R2 pricing](https://developers.cloudflare.com/r2/pricing/)). No per-bucket object or storage cap; 1 write per second to the same key ([R2 limits](https://developers.cloudflare.com/r2/platform/limits/)). | Reaching the free tier is a bill, not a failure: nothing a player sees. A failed write returns "Could not record that Appeal." (500) and the game plays on. | 179 objects, 34.3 kB, in the 78 days since the bucket was made on 2026-08-05 (`wrangler r2 bucket info rhyme-bee-flags`). About 2.3 Appeals a day, 192 bytes each. Session Records ([Send a Session Record for every Daily Puzzle Session](https://github.com/jkenna-Colgate/rhyme-bee/issues/230)) have no size estimate yet. Years to 10 GB = 10 GB / (records a day x bytes each x 365): at 100 records a day of 4 kB, 68 years; at 1,000 a day of 16 kB, 1.7 years. Class A at 1,000 a day is 3% of the free tier. | No date at today's rate. With Session Records, set by player count and record size, as above |
| **Rate limiting bindings** `APPEAL_LIMITER` 20/60 s, `FEEDBACK_LIMITER` 5/60 s | Generally available since 2025-09-19 ([changelog](https://developers.cloudflare.com/changelog/post/2025-09-19-ratelimit-workers-ga/)). The binding docs state no plan restriction, no price and no namespace cap; `period` must be 10 or 60, and counting is approximate and per location ([rate limit binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)). It works on this account's plan: the 2026-09-20 deploy carries it. | Exhausted: `limit()` returns `success: false`, and `web/worker/http.ts` answers 429 with a sentence for the player ("Too many Appeals just now"). Withdrawn: undocumented. If the binding were absent, `config.limiter.limit` would throw and the route would fail with a Worker exception; assets are untouched. | `wrangler deployments list --name bramble-bee`: last deploy 2026-09-20T19:45Z, after the commit that added the bindings. | No date |
| **Scheduled workflows** on GitHub Actions | "In a public repository, scheduled workflows are automatically disabled when no repository activity has occurred in 60 days" ([events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows); [disable and enable workflows](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows)). **Neither page defines repository activity**, so whether a commit pushed by the workflow counts is not documented. Runs can be delayed at high load, and queued jobs may be dropped. Free for public repos on standard runners ([Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)). | **Silent:** the workflow stops running and nothing fails, so no failure email is sent. The pages name no warning before disabling. Re-enable with `gh workflow enable`. | No workflow exists (`.github/workflows` absent; `gh api repos/jkenna-Colgate/rhyme-bee/actions/workflows` total 0). Repo is public, Actions enabled, last push 2026-10-14. | Nothing to break today. Once a job exists: 60 days after the last activity, if self-commits do not count |
| **Deploy from CI**: a Cloudflare API token | Optional TTL: "Not setting the end date or `notAfter` means the token does not expire", and "By default, tokens do not expire" ([restrict tokens](https://developers.cloudflare.com/fundamentals/api/how-to/restrict-tokens/)). Account API tokens are offered for service use not tied to a user ([create token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)). | An expired token fails the deploy step; the version already live keeps serving. | Not yet made: deploys run from the maintainer's machine through `wrangler login` (OAuth). | No date if made without an end date |
| **R2 read-only token** for the Appeals pull (named in ADR-0021) | Same TTL rule as any Cloudflare API token. Created in the setup ticket's Step 8 on or about 2026-08-05; its end date, if any, is not recorded in the repo. | The pull fails, so the Appeals job judges nothing; the run fails and emails the owner. | Read it on the dashboard's API token list, or `curl https://api.cloudflare.com/client/v4/user/tokens/verify` with the token (read-only, returns its status and `expires_on`). | Unknown until read |
| **Claude subscription token** (`claude setup-token`) | One year. It needs a Pro, Max, Team or Enterprise plan ([Claude Code authentication](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token)). As ADR-0021 states. | The model step fails, the run fails, GitHub emails the workflow's owner (ADR-0021). The work with no model in it does not wait for it. | Not yet minted for the job. | One year from minting |
| **Fixed model ID** for the Judge | Sonnet 5.5 retired no sooner than 2027-09-28, as recorded in the findings on [Front-load or rolling: does the unattended loop call an LLM?](https://github.com/jkenna-Colgate/rhyme-bee/issues/227) and ADR-0021. | The job stops, by design (ADR-0021). | | **No sooner than 2027-09-28** (341 days) |
| **Compatibility date** `2026-08-05` | "The Workers runtime will support old compatibility dates forever"; a change that would break live Workers is announced: "Cloudflare will actively contact affected developers" ([compatibility dates](https://developers.cloudflare.com/workers/configuration/compatibility-dates/)). | Nothing. | `web/wrangler.jsonc`. | No date |
| **Node.js for CI** (wrangler and the build) | wrangler 4.119.0 declares `"node": ">=22.0.0"` (`web/node_modules/wrangler/package.json`), and Cloudflare supports "the Current, Active, and Maintenance versions of Node.js" ([install wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/)). Node 22 reaches end of life 2027-04-30, Node 24 on 2028-04-30 ([Node release schedule](https://github.com/nodejs/Release/blob/main/README.md)). GitHub removed Node 20 from Actions runners for JavaScript actions on 2026-09-23 and runs them on Node 24 by default since 2026-06-16 ([changelog](https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/)). | The deployed Worker does not run on Node, so the game is unaffected. A CI job pinned to Node 22 runs an unsupported pairing after 2027-04-30; what fails, and when, depends on later wrangler and runner releases, which no source dates. | Local Node is 22.17.0. No CI yet. | 2027-04-30 for a Node 22 pin; 2028-04-30 for Node 24 |
| **Cloudflare account and `kenna-dev` workers.dev subdomain** | No inactivity policy for accounts or Workers was found in Cloudflare's docs; the documented inactivity deletions are for unactivated or moved zones, which this account does not depend on. The workers.dev page states no expiry or renewal for the subdomain and calls it a free website meant for personal or hobby projects ([workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)). | | The live site answers 200 today (`curl -I https://bramble-bee.kenna-dev.workers.dev/`). | No date found |
| **GitHub account** | GitHub does not release or reclaim usernames for apparent inactivity; accounts "inactively held for future use" fall under name squatting and "may be removed or renamed without notice" ([username policy](https://docs.github.com/en/site-policy/other-site-policies/github-username-policy)). The PAT one-year-unused revocation is the only inactivity rule that touches this setup (row above). | | | No date found |

## Notes on the rows

**Which failures anyone hears about.** Of the rows above, only a failing Actions
run sends an email (to the workflow's owner, and for scheduled runs, the user
who last changed the cron line, per the events page). The stale Schedule days,
the end of the Schedule, an expired feedback token, an R2 write failure and a
disabled workflow all fail without telling the maintainer. The player is shown
an error for a failed note or Appeal, and nothing at all for Free Play standing
in for a Daily Puzzle.

**The 60-day rule and self-commits.** GitHub's docs say "repository activity"
and never say what counts. The ADR-0021 plan (a run report committed by every
run) depends on a commit by the workflow counting. A related fact, and only
that: the most-used keepalive action for this problem,
`gautamkrishnar/keepalive-workflow`, shows "Access to this repository has been
disabled by GitHub Staff due to a violation of GitHub's terms of service" as of
2026-10-22. Its README is no longer readable, so what it did is not checked
here. The only way to settle the question is to run a scheduled workflow that
commits in a throwaway public repo for more than 60 days, or to ask GitHub.

**What assets mean for the free plan.** Because assets are matched before the
Worker and do not count toward the daily request limit, the number of players
who can load and play the game is not bounded by any limit in the table. The
Workers billing page says the 429 behaviour on an exhausted free plan applies to
`run_worker_first` patterns, which this config does not use.

**Measurement method.** The Worker figures came from one read-only GraphQL
Analytics query (`workersInvocationsAdaptive`, filtered to `bramble-bee`). The
counts are Cloudflare's adaptive-sampled figures and are an upper bound on a
small number, not an exact one. R2 operation counts were not pulled; the object
count stands in for writes, since each Appeal is one `put`.

## Sources

| Source | Used for |
| --- | --- |
| [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) | Daily requests, Error 1027, CPU, memory, asset file limits |
| [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) | Assets free and unlimited, only Worker hits counted |
| [Static assets billing and limitations](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) | 429 for `run_worker_first` on an exhausted free plan |
| [Worker script routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/) | Assets matched before the Worker runs |
| [Rate limit binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [GA changelog](https://developers.cloudflare.com/changelog/post/2025-09-19-ratelimit-workers-ga/) | Binding behaviour and status |
| [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [R2 limits](https://developers.cloudflare.com/r2/platform/limits/) | Free tier, overage, per-bucket limits |
| [Compatibility dates](https://developers.cloudflare.com/workers/configuration/compatibility-dates/) | Old dates supported forever |
| [Restrict tokens](https://developers.cloudflare.com/fundamentals/api/how-to/restrict-tokens/), [Create token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/) | Cloudflare API token TTL |
| [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/), [Install wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/) | Subdomain terms, Node support policy |
| [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [Disable and enable workflows](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows), [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) | 60-day rule, schedule behaviour, cost |
| [Managing PATs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens), [Token expiration and revocation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation), [REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) | Feedback token and API limits |
| [Username policy](https://docs.github.com/en/site-policy/other-site-policies/github-username-policy) | GitHub account inactivity |
| [Node 20 deprecation on runners](https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/), [Node release schedule](https://github.com/nodejs/Release/blob/main/README.md) | Runner and Node end-of-life dates |
| [Claude Code authentication](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token) | `claude setup-token` lifetime |
| `web/wrangler.jsonc`, `web/worker/*.ts`, `src/schedule.ts`, `data/schedule.json`, `docs/adr/0021-*.md` | Bindings, failure paths, Schedule lookup |
| `wrangler deployments list`, `wrangler r2 bucket info`, `wrangler secret list`, GraphQL Analytics, `gh issue list`, `gh api`, `curl` | Today's use (read-only) |
