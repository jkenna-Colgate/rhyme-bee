# rhyme-bee

A daily word puzzle where the mechanic is rhyming, not spelling.

TypeScript, ES modules. Game logic lives in `src/`, tested with Vitest in
`src/__tests__/`. The Rhyme Index is built offline from the pinned sources in
`data/` and written to `dist-data/`; `web/` is the player-facing front end and
carries its own package.

- `npm test` — run the suite
- `npm run typecheck` — `tsc --noEmit`
- `npm run build:index` — rebuild the Rhyme Index from `data/`

The vocabulary below is authoritative — use these terms exactly, and prefer
them over the synonyms each entry marks as _Avoid_.

@CONTEXT.md

Decisions already made live in `docs/adr/`. ADR-0001 and ADR-0003 in particular
were reversed mid-design — read the rejected options before proposing
alternatives.

## Testing

**Worker routes are tested.** The tickets that introduced them called transport
untested by convention; three separate agents wrote route tests anyway, so the
convention lost and the tests stay. `web/worker/__tests__/` covers method
handling, the body cap and the refusal path per route. Validation and
adjudication are pure modules and are tested apart from the transport around
them.

`vitest.config.ts` exists for one exclusion: `.claude/worktrees/`, where agent
checkouts keep their own copy of every test file. Without it a bare `npm test`
walks into them and reports several times the real suite — and passes, which is
the dangerous direction to be wrong in. The real suite is 72 files.

## Context hygiene

Sessions here run out of room on tool output, not on documentation. Four rules,
in order of what actually costs:

- **Never `Read` `CLAUDE.md`, `AGENTS.md`, or `CONTEXT.md`** — they are already
  in context via the imports above. Re-reading `CONTEXT.md` costs more than
  every ADR put together.
- **Browser work gets its own session.** Screenshots are the single largest
  consumer; a browser QA pass will not leave room for implementation. Capture
  one at the end of a flow, not per step, and when you need *facts* rather than
  *appearance* prefer `read_page`, `get_page_text`, or `read_console_messages`
  with a `pattern` filter.
- **`Grep` for the symbol, then read the range around it.** `session.test.ts`,
  `normalise.ts`, `affixes.ts`, `session.ts` and `web/src/PuzzleView.tsx` are
  each thousands of tokens to open whole, and get opened repeatedly.
- **Filter output at the source** — `gh issue view N --json title,body` over the
  full render, and pipe verbose commands through `tail` or `grep`. `npm test` is
  already quiet on success; keep it that way.

Read the one ADR the task turns on, not the set. They are deliberately not
imported here, so they cost nothing until opened.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `jkenna-Colgate/rhyme-bee`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical role names are used verbatim. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
