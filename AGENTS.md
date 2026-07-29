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

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `jkenna-Colgate/rhyme-bee`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical role names are used verbatim. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
