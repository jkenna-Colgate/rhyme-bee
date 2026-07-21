# rhyme-bee

A daily word puzzle where the mechanic is rhyming, not spelling.
Design-stage: no application code yet.

Start with `CONTEXT.md` for vocabulary and `docs/adr/` for decisions
already made. ADR-0001 and ADR-0003 in particular were reversed
mid-design — read the rejected options before proposing alternatives.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `jkenna-Colgate/rhyme-bee`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical role names are used verbatim. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
