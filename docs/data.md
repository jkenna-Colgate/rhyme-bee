# Data pipeline

The Rhyme Index is a build artifact derived from three static, pinned inputs.
The raw data is **not committed** (large, regenerable — see `.gitignore` and
ADR-0003/0004). The build reads it from `data/`, writes `dist-data/index.json`,
and the runtime loads that artifact with no network call.

```
data/            (uncommitted)         dist-data/         (uncommitted)
  cmudict.dict   pronunciations          index.json          the built index
  words.txt      wordhood gate      ->   dropped-report.json why each word dropped
  names.txt      proper nouns            derived-report.json what gained a reading
  prevalence.csv knownness
  sources.json   pinned versions
  supplement.dict human overrides  (committed — see below)
```

`supplement.dict` is the one hand-authored input and the only committed file in
`data/` — the permanent human override layer (ADR-0009). The build merges it over
the pinned inputs, so its adds and stress corrections survive the rebuild.

Build with `npm run build:index`, then `npm run histogram` to answer ADR-0004.

## Build stages

The pinned inputs pass through an ordered sequence of stages before the index is
constructed. The **order is a contract**, not an implementation detail — adding a
stage means choosing a position in this list and saying why:

| # | Stage | Code | What it asserts |
|---|---|---|---|
| 1 | Committed supplement | `src/supplement.ts` | *readings* — hand-authored adds and stress corrections (ADR-0009) |
| 2 | Coverage derivation | `src/coverage.ts` | *readings* — composed from a known stem, for well-known words CMUdict has none for |
| 3 | Normalisation | `src/normalise.ts` | the *accent* — contrasts a General American listener cannot hear are erased (ADR-0010) |

Normalisation runs **last** because the stages before it assert readings while it
asserts the accent those readings are spoken in. A hand-authored correction is
therefore an input to the accent specification, never an exemption from it, and
so is a derived reading. Normalisation also runs **before any Rhyme Key is
computed**, so a verdict and the respelling shown beside it are derived from the
same reading and cannot disagree.

Stage 2 runs after stage 1 so a hand-authored reading always beats a composed
one, and it **never grants wordhood** — only stage 1 can introduce a word. Its
affix inventory (`src/affixes.ts`) is plain configured data, so widening
coverage is a data change; its candidate set is bounded to words that are in the
prevalence norms, already carry wordhood, are not names, and have no reading
yet. It is a single pass, so a derived reading is never itself a stem in the
same build. Everything it produced is listed in `derived-report.json`, with the
stem and the rule, so over-generation is visible.

The inventory holds **prefixes** (`un-`, `re-`, …) and **stress-neutral
suffixes** (`-ly`, `-ness`, `-er`, …), and the two carry different risk. A
prefix's phonemes sit *outside* the Rhyme Key, so a prefixed reading cannot
change a rhyme verdict; a stress-neutral suffix leaves the stem's stress alone,
which means the key runs *through* the suffix and a wrong suffix reading is a
wrong verdict. Suffix rules therefore refuse anything they cannot vouch for: the
composed key must be the stem's key extended, a geminate at the seam collapses
to one sound (`zestful` + `-ly` has one `L`), and a stem whose readings disagree
about where the stress falls is declined outright, because `articulate` the verb
and `articulate` the adjective are two words and `-ly` attaches to one of them.
The voicing-conditioned `-ed` and `-s` are not in the inventory yet.

Nothing downstream of stage 3 knows the stages exist: Rhyme Key computation,
respelling, tiering, Puzzle building, adjudication and curation all receive
ordinary pronunciations.

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
