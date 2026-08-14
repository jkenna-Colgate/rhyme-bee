# The Editor's Pass is a browser tool, not a CLI

The Editor's Pass moves from `scripts/editor.ts` to a **dev-only web mode**, and the CLI retires once it works. The browser renders and clicks; every computation stays in Node, reached through dev-server endpoints in the established `apply: "serve"` Vite plugin pattern of `web/supplementPlugin.ts`. Both halves of the pass move together — the readout, the Tier judgements ([ADR-0015](./0015-tier-overrides-record-retrieval-not-recognition.md)) and the adds — because a pass split across two surfaces is worse than either surface alone.

## Why the CLI is the wrong shape for this work

The pass is a *read*, not a play: the editor scans a day's Answers and Bonus Words as text, against a third-party rhyme list in another browser window, and acts on what the read turns up. Three frictions follow from putting that on a command line, and only the first is fixable without moving.

**Invocation is hostile on the target platform.** PowerShell eats the bare `--` separator before npm sees it, so `npm run editor:read -- --date 2026-08-20` silently arrives as a lone positional and produces the right day *by luck*; the same mangling of an `add` turns `--words=earache --rhymeKey="EY K"` into three words aimed at the wrong Rhyme Key. `scripts/editorArgs.ts` documents this at length, which is itself the tell.

**Every judgement costs a round trip.** Read the output, hold a 200-word list in your head, compose a new command naming a word that is already on screen, run it, rebuild, re-read to confirm. Retyping a word's spelling into a flag when the word is in front of you is pure friction.

**A Tier judgement is pick-from-a-displayed-list**, which is the task a command line is worst at and a UI is for. This is the half the CLI serves least well, and it is the half [ADR-0015](./0015-tier-overrides-record-retrieval-not-recognition.md) is about to make routine.

The adds are different — composing a pronunciation is genuinely hard, and `scripts/editorAdd.ts`'s per-word verify-and-refuse readout is good at it. That asymmetry argued for moving only the Tier half. It is rejected: a pass where judgements happen in a browser and adds happen in a terminal means remembering which surface owns which act, every night, forever. One surface that is imperfect for one of its two jobs beats two surfaces that are each ideal for one.

## Why not an interactive terminal session

The strongest rejected option, and the cheapest by an order of magnitude: `npm run editor` opening a readline loop against the displayed day — `b counterthrust`, `r bolder`, `a earache`, `w` to write. It fixes the two frictions that are actually about invocation. There are no flags, so the `--` hazard disappears entirely; the index loads once, so the round trip collapses; it is perhaps 150 lines and needs no new infrastructure.

It cannot fix the third. Reading a 200-word list in a terminal, and alt-tabbing to the rhyme list the pass is conducted against, are the parts that make the pass tiring, and a REPL leaves both exactly where they were.

Two further options were considered and rejected. A **worklist file round-trip** — emit a day's words with a blank verdict column, edit it in your own editor, read it back — is diffable and batch-friendly, but is two steps and still alt-tab. **Fixing invocation only**, with positional arguments instead of flags, is trivial and structural of nothing.

## Why the browser computes nothing

The player's shell loads the 15 MB index and adjudicates client-side. The editor does not, and asks Node for a day's readout instead — a few KB.

The decisive reason is that **`add` must be server-side regardless**: it appends to `data/supplement.dict`, shells out to an agent to author readings, and writes the deferred queue. Computing the readout in the browser and the add in Node would rebuild the split-surface problem *inside* the new UI. Beyond that, nothing is lost by moving compute server-side: `scripts/editorRead.ts:192` and `web/src/bootPuzzle.ts:102` already call the same `pinSeed` and `buildPuzzle` on the same `RhymeIndex`, differing only in whether the index came from disk or `fetch`, so a readout computed in Node is identical to one computed in the browser.

**This does not weaken [ADR-0013](./0013-adjudication-never-crosses-the-network.md).** That ADR is about the *player's* Session — no request in flight, offline play, a Reveal the client cannot be made to leak, and no server to depend on. The editor is a maintainer reading their own repository over localhost, with no player, no Session and no adjudication of anyone's Submission. The game still ships as a static client-side artifact; nothing here is deployed.

## Consequences

- **Dev-only is structural, not conventional.** `configureServer` never runs in a production build, so the endpoints cannot ship even by mistake. This matters more here than for `supplementPlugin.ts`: an editor route that survived into production would be a write path from the public internet into `data/`.

- **The enabling change is a refactor worth doing anyway.** `editorRead.ts` and `editorAdd.ts` currently interleave computation with `console.log` (`readDay` measures, then makes five `print*` calls). They must return their readouts as data instead. That is what makes the pass testable at all, and it is why the web mode is additive rather than a rewrite — the existing printers become one renderer over the returned value, and the React view becomes another.

- **Retirement is sequenced, not simultaneous.** The CLI keeps working, fed by the same returned values, until the web mode covers the pass. Only then is `scripts/editor.ts` removed — along with `scripts/editorArgs.ts` and its tests, a currently-tested seam that disappears. Its coverage moves to the pure modules the refactor exposes, which is a better place for it: the arg parser was tested because it was the only piece of the pass that could be.

- **The plugin gets tests.** `AGENTS.md` records that the Worker routes were tested despite a convention calling transport untested, and the convention lost. This plugin is the same shape and carries the same expectation — method handling, the refusal path, and validation apart from the transport around it.

- **Rebuild on write, always; no preview mode.** A full `npm run build:index` is **2.3 s** (133k pronunciations, 370k words, a 15 MB artifact), and reloading the built index is 510 ms. That is cheap enough that every figure shown is the real artifact, which removes preview-versus-truth as a category of bug. *(Distinct from the four-minute figure in `docs/editors-pass.md`, which is the deploy.)*

- **Tier previews exactly client-side; `add` does not.** Moving a word between the two lists and recomputing `measureAnswers` needs only its length and knownness, both already in the day's payload — the same arithmetic, so optimistic UI carries no divergence risk and judgements feel instant with a batched rebuild. An add changes pronunciations, coverage and normalisation, and can only be believed after a rebuild.

- **Rechecking is scoped by blast radius.** Re-checking one day costs ~90 ms; all 260 costs 23 s. Since the schedule uses 260 distinct Rhyme Keys with no repeats, a judgement touches at most one scheduled day per Rhyme Key of the word, so the editor rechecks those and leaves the full sweep as a deliberate pre-ship action.

- **`audition` becomes a button.** The existing "read a replacement Seed before committing to it" command (`editorRead.ts:82`) is the remedy when a day is spoiled, and belongs beside the day it would replace rather than in a separate invocation.

- **The overview should shout about unpinnable days before drift.** 0 of 260 scheduled days currently drift out of band; **9 cannot be pinned against the shipped index at all**. A day that cannot be built is a worse fact than a day whose figures moved, and the readout should rank them that way.

- **`docs/editors-pass.md` is rewritten, not amended.** It is a command-by-command walkthrough whose every step changes, including the `--` warnings that become moot.

## Superseded in part (2026-08-11)

[ADR-0017](./0017-candidates-are-judged-in-the-editors-pass.md) supersedes one narrow point recorded alongside this pass — that a disagreement over a reading is settled **offline against the Candidate Queue** rather than from the browser. Judging Candidates becomes a surface inside the Editor's Pass. **Nothing this ADR decides is amended:** the browser still computes nothing, dev-only is still structural, and the queue's readout is served over a dev-only endpoint exactly as the day's is.
