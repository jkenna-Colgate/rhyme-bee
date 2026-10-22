# Passing flags to the scripts on Windows PowerShell

The scripts here take flags: `play` takes `--day 1..7` (1 easiest to 7 hardest)
or `--seed <word>`, `editor:read` and `editor:add` take their own, and
`scripts/lookup.ts` and `scripts/wayfinder.ts` take `--key`, `--section`,
`--line` and `--dry-run`. PowerShell mangles flags in three separate ways. Git
Bash does none of them, so this page is only about PowerShell.

## The `--` separator

Do not pass flags through `npm run`. PowerShell eats the bare `--` separator
before npm sees it, npm reads the flags that follow as its own configuration,
and they reach the script either mangled or not at all, silently, with no
error. The equals form is not a fix; it fails the same way.

Invoke tsx directly, or quote the separator:

```
npx tsx scripts/play.ts --day 6        # nothing to lose
npm run play '--' '--day=6'            # quoting survives PowerShell
```

This applies to every flag-taking script here: `play`, `editor:read` and
`editor:add` have npm scripts and so can be reached either way. `lookup` and
`wayfinder` have none, and are only ever invoked through `npx tsx`. In Git Bash
the bare `--` survives and the ordinary form works.

## Comma-separated lists

PowerShell has a second, separate trap for the scripts taking comma-separated
lists (`editor:add --words`): it reads `a,b` as an array literal and passes it
as the single argument `a b`. **Quote the list** (`--words "ule,rule"`) in
either flag spelling.

## Double quotes inside an argument

Windows PowerShell 5.1 drops a double quote inside an argument it passes to a
native program, `npx` included, so the script receives the argument with the
quote missing and no error. Write each such quote as `\"` inside a
single-quoted argument:

```
npx tsx scripts/wayfinder.ts decide 218 --section "Decisions so far" --line '- [Say \"yes\"](url): gist'
```

Git Bash passes the quote through as written.
