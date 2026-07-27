# Data pipeline

The Rhyme Index is a build artifact derived from three static, pinned inputs.
The raw data is **not committed** (large, regenerable — see `.gitignore` and
ADR-0003/0004). The build reads it from `data/`, writes `dist-data/index.json`,
and the runtime loads that artifact with no network call.

```
data/            (uncommitted)         dist-data/         (uncommitted)
  cmudict.dict   pronunciations   ->     index.json         the built index
  words.txt      wordhood gate    ->     dropped-report.json why each word dropped
  names.txt      proper nouns
  prevalence.csv knownness
  sources.json   pinned versions
  supplement.dict human overrides  (committed — see below)
```

`supplement.dict` is the one hand-authored input and the only committed file in
`data/` — the permanent human override layer (ADR-0009). The build merges it over
the pinned inputs, so its adds and stress corrections survive the rebuild.

Build with `npm run build:index`, then `npm run histogram` to answer ADR-0004.

## Inputs

| File | Format | Purpose |
|---|---|---|
| `cmudict.dict` | CMUdict text (`WORD  P1 P2`) | pronunciations + stress |
| `words.txt` | one lower-case word per line | wordhood; **excludes names** |
| `names.txt` | one name per line | labels a rejection as Proper Noun |
| `prevalence.csv` | header with `Word`,`Prevalence` | knownness (lemma → score) |
| `sources.json` | `{ "<name>": "<version/url>" }` | pinned provenance |
| `supplement.dict` | CMUdict text, `#` comments | **committed** human adds + stress corrections (ADR-0009) |

`words.txt` is the wordhood authority and must exclude proper nouns, so CMUdict's
surnames do not leak in (ADR-0003). `names.txt` only affects the *reason* a
rejection carries, never whether a name is accepted — names are never valid.

## Sources and licences

| Source | Version | Licence |
|---|---|---|
| CMUdict | pin in `sources.json` | BSD-2-Clause ✅ |
| Word prevalence norms (Brysbaert et al. 2019) | https://osf.io/5fk8d/ | **Unconfirmed** ⚠️ |
| Common-word list | pin in `sources.json` | record on selection |
| Names list | pin in `sources.json` | record on selection |

⚠️ The prevalence-norms licence is unconfirmed — academic-norms use is not a
commercial licence. This is load-bearing for the Answer/Bonus split and is
tracked as a human task (issue #5). Settle it before the tier split ships.
