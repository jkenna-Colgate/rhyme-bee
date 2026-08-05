# Data pipeline

The Rhyme Index is a build artifact derived from three static, pinned inputs.
The raw data is **not committed** (large, regenerable — see `.gitignore` and
ADR-0003/0004). The build reads it from `data/` and writes the artifact to
`dist-data/`, and adjudication runs against that artifact with no network call
(ADR-0013).

```
data/            (uncommitted)         dist-data/            (uncommitted)
  cmudict.dict   pronunciations          index-<hash>.json     the built index
  words.txt      wordhood gate      ->   index.manifest.json   which one is current
  names.txt      proper nouns            dropped-report.json   why each word dropped
  prevalence.csv knownness               derived-report.json   what gained a reading
  sources.json   pinned versions
  supplement.dict human overrides  (committed — see below)
  demotions.txt   human overrides  (committed — see below)
```

The index is **content-addressed**: its filename carries a hash of its contents,
so a rebuilt judge is a new filename rather than new bytes under an old one, and
the artifact can be served immutably and still reach every player on the next
deploy. `index.manifest.json` names the current one. Nothing reads the manifest
at runtime — the web build reads it here and bakes the filename into the bundle
— and it is kept anyway as the upgrade path to a split deploy. `scripts/indexArtifact.ts`
owns the naming and is what every reader resolves through; `web/README.md` has
the deploy half.

`supplement.dict` and `demotions.txt` are the hand-authored inputs and the only
committed files in `data/` — the permanent human override layer. The build merges
them over the pinned inputs, so they survive the rebuild: the supplement's adds
and stress corrections assert *readings* (ADR-0009), the demotion list corrects
*wordhood* (ADR-0011, amended). The rest of `data/` is regenerable, so a hand-edit
to `words.txt` or `names.txt` is lost on the next fresh clone; that is the whole
reason the demotion list exists rather than an edit in place.

Build with `npm run build:index`, then `npm run histogram` to answer ADR-0004.

## Build stages

The pinned inputs pass through an ordered sequence of stages before the index is
constructed. The **order is a contract**, not an implementation detail — adding a
stage means choosing a position in this list and saying why:

| # | Stage | Code | What it asserts |
|---|---|---|---|
| 0 | Committed demotions | `src/demotions.ts` | *wordhood* — proper nouns and junk the upstream word list wrongly holds (#90) |
| 1 | Committed supplement | `src/supplement.ts` | *readings* — hand-authored adds and stress corrections (ADR-0009) |
| 2 | Coverage derivation | `src/coverage.ts` | *readings* — composed from a known stem, for well-known words CMUdict has none for |
| 3 | Normalisation | `src/normalise.ts` | the *accent* — contrasts a General American listener cannot hear are erased (ADR-0010) |

Demotion runs **first**, and is the only stage that *withdraws* wordhood. Placing
it ahead of the supplement makes it a correction to the pinned word list rather
than an override of the override: every stage below reads a corrected list, and
the supplement's standing refusal to launder a name into a word (stage 1) then
covers demoted names without knowing this stage exists. It is hand-curated and
bounded to words a human read — 9,133 words are in *both* upstream lists,
`heart`, `faith` and `joy` among them, so name-hood can never be allowed to
outrank wordhood wholesale.

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
| `demotions.txt` | `<word> <reason>`, `#` comments | **committed** human wordhood corrections (#90) |

`words.txt` is the wordhood authority and must exclude proper nouns, so CMUdict's
surnames do not leak in (ADR-0003). `names.txt` only affects the *reason* a
rejection carries, never whether a name is accepted — names are never valid.

The upstream word list does *not* honour that contract: it holds `heinz`,
`algiers`, `marx`, and `kate`. Because the gate tests wordhood before name-hood,
such a word was accepted as an ordinary Answer even when `names.txt` also held
it — being a known name never saved it. `demotions.txt` is where that is
corrected, one hand-read word per line, with the rejection reason the player will
receive.

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
