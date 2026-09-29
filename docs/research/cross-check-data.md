# Third-party data that could cross-check the engine offline

Research for [What third-party rhyme and knownness data could cross-check the engine offline?](https://github.com/jkenna-Colgate/rhyme-bee/issues/221),
a ticket on the map [Wayfinder: run the game unattended at a Playability Bar](https://github.com/jkenna-Colgate/rhyme-bee/issues/218).
Researched 2026-09-29. Every cross-check below runs at build time or in a
maintainer's loop; nothing here proposes a network call during adjudication
(ADR-0013).

## Answer in brief

- **Pronunciation: Wiktionary, read through Kaikki's Wiktextract dump.** It is
  the only large source found that is *independent of CMUdict*, labels each
  transcription with its accent (`General-American`, `US`,
  `Received-Pronunciation`, ...) and keeps stress marks. Licence CC BY-SA 4.0
  plus GFDL. WikiPron's pre-scraped US file is a cheap first pass but strips
  stress, so it can check a Rhyme Key's segments and never its stress.
- **Measured (WikiPron US vs CMUdict):** WikiPron covers 73% of the lexicon's
  Answer band. On the words both hold, 96.7% agree on the Rhyme Key's segments.
  In a hand-judged sample of the disagreements, **CMUdict was wrong twice as
  often as Wiktionary**, but **44% were not errors at all** (both readings are
  real General American variants). So a disagreement is a Candidate for a judge,
  never a fix to apply unattended.
- **Datamuse is not a second opinion on pronunciation.** Its own documentation
  says its phonetic relations come from CMUdict. It can check our *rules*
  (normalisation, derivation, supplement) against theirs, and it needs an API
  key from 2027-01-01.
- **Knownness: nothing measures Retrieval at scale.** The only data collected
  from people *producing* rhymes are two small norm sets (397 and 477 cues). The
  largest production dataset (Small World of Words) is semantic free
  association, licensed non-commercial and no-derivatives. Corpus frequency is
  already in hand (the `FreqZipfUS` column of `data/prevalence.csv`), and
  measured here it does **not** pick out the words editors moved to Bonus
  Words: if anything they are *more* frequent than their prevalence peers.

## What the engine already uses

From `data/sources.json` and [docs/data.md](../data.md): CMUdict (BSD-2-Clause)
for pronunciation, Brysbaert et al. (2019) word prevalence for knownness, the
dwyl `words_alpha.txt` list for wordhood, SSA baby names for proper nouns, and
the committed `supplement.dict`. ADR-0011 records that the frozen rule set is
"demonstrably imperfect" (6.8% of stress promotions override a shape CMUdict
usually marks unstressed), and ADR-0015 that prevalence measures recognition,
not Retrieval.

## Pronunciation and rhyme sources

| Source | Independent of CMUdict? | Accent | Stress kept? | Licence | Size / coverage |
|---|---|---|---|---|---|
| **Wiktionary via Kaikki (Wiktextract)** | Yes, hand-written by editors | Per-transcription tags: `General-American`, `US`, `Received-Pronunciation`, some untagged | Yes | CC BY-SA 4.0 and GFDL (Wiktionary's terms) | Raw dump 2.8 GB gzipped, all languages; current extract from the 2026-09-02 enwiktionary dump |
| **WikiPron** (`eng_latn_us_broad.tsv`) | Yes (scraped from Wiktionary) | "US", but includes dialect-unlabelled transcriptions | **No**, stripped | Code Apache 2.0; data under Wiktionary's terms | 106,931 rows; covers 73.3% of the Answer band (measured below) |
| Datamuse API (`rel_rhy`) | **No**: "The CMU pronouncing dictionary is used as a source of phonetic transcriptions" | Merged: `rel_rhy=stock` returns `stalk`, `talk`, `hawk` | n/a | No licence stated; asks for acknowledgement in public apps | 100,000 requests/day; API key required from 2027-01-01 |
| MFA English (US) dictionary v3.0.0 | Sources not stated | General American | Not indicated in its docs | CC BY 4.0 | 80,723 entries |
| Moby Pronunciator (Grady Ward) | Yes | Not verified | Yes | Public domain in the USA | Released 2002; entry count not stated on the Gutenberg page |
| Unisyn (CSTR, Edinburgh) | Yes | Accent-independent keysymbols; "a number of UK, US, Australian and New Zealand accents" | Yes | "non-commercial use only", licence agreement before download | Not stated on the project page |

Notes on each, with sources:

- **Kaikki / Wiktextract.** Pronunciations sit in each entry's `sounds` list,
  each with an `ipa` string and `tags` naming the accent
  ([wiktextract README](https://github.com/tatuylonen/wiktextract);
  [Kaikki raw data page](https://kaikki.org/dictionary/rawdata.html)). Checked on
  live entries: `biomass` carries `/ˈbaɪoʊˌmæs/` tagged `General-American`, with
  the secondary stress on *-mass* that CMUdict lacks (see below); `sphere`
  carries `/sfɪɚ/` tagged `US` alongside RP, Scottish and an untagged `/sfɛː/`.
  So filtering to `General-American` or `US` tags is necessary and sufficient to
  keep non-American readings out. Licence from
  [Wiktionary:Copyrights](https://en.wiktionary.org/wiki/Wiktionary:Copyrights):
  CC BY-SA 4.0 (share-alike, attribution) and GFDL (a link back to the entry
  satisfies attribution). Cite Ylonen, "Wiktextract: Wiktionary as
  Machine-Readable Structured Data", LREC 2022.
- **WikiPron.** Lee et al., "Massively multilingual pronunciation mining with
  WikiPron", LREC 2020 ([repo](https://github.com/CUNY-CL/wikipron);
  [paper](https://aclanthology.org/2020.lrec-1.521.pdf)). The paper says
  stress-removal and syllable-boundary-removal "options are enabled for the
  massively multilingual database", and the published US file contains no `ˈ`
  at all (checked). The README says "Transcriptions without dialect labels are
  included regardless of flag settings", which is where RP forms in the US file
  come from. Running WikiPron ourselves with stress kept is possible, but at that
  point Kaikki is the same data with the tags intact.
- **Datamuse.** From the [API page](https://www.datamuse.com/api/): CMUdict is
  the phonetic source; `score` "has no interpretable meaning, other than as a way
  to rank the results"; the `f` tag is occurrences per million words in Google
  Books Ngrams. Because the pronunciations are CMUdict's, a Datamuse rhyme our
  index lacks points at a rule or override difference, not at a pronunciation
  error. The Editor's Pass already pastes third-party rhyme lists by hand; this
  is the same signal, automatable, until the key requirement arrives.
- **MFA, Moby, Unisyn** were not measured. MFA's docs do not say what the
  dictionary was built from, so its independence from CMUdict is unknown
  ([MFA docs](https://mfa-models.readthedocs.io/en/latest/dictionary/English/English%20%28US%29%20MFA%20dictionary%20v3_0_0.html)).
  Unisyn's non-commercial licence is the same shape of risk ADR-0003 already
  carries for prevalence ([Unisyn](https://www.cstr.ed.ac.uk/projects/unisyn/)).
  Moby is public domain ([Gutenberg #3205](https://www.gutenberg.org/ebooks/3205))
  but twenty-plus years old and unmaintained.

### Measurement: WikiPron US against CMUdict

**Method.** Lexicon = CMUdict headwords that are in `data/words.txt`, purely
alphabetic, and not in `data/names.txt`: 51,319 words (ADR-0011 counts 51,321
for the playable lexicon, so this is the same population). For each word, every
CMUdict reading's Rhyme Key (last vowel with stress 1 or 2, to the end) was
mapped to IPA. A word *agrees* if some Rhyme Key is a suffix of some WikiPron US
transcription. Both sides were normalised for merged General American and for
notation: cot-caught merged except before /r/; Mary-marry-merry merged;
`ɝ/ɜ˞/ə+ɹ` → `ɚ`; a vowel + `ɚ` equals vowel + `ɹ` (Wiktionary writes `sphere`
as `sfɪɚ`); length marks, tie bars and non-syllabic diacritics dropped;
syllabic `l̩ n̩ m̩` → schwa + consonant; pre-nasal `eɪŋ`/`ɛ̃` → `æŋ`; `ʌɪ` → `aɪ`.
*Lenient* additionally treats `ɪ`, `ə`, `i` as one vowel after the key's first
vowel. Bands use prevalence ≥ 0 as a stand-in for the Answer band (ADR-0003
puts the threshold "around 0.0"). The comparator is approximate and is itself a
source of false disagreements, counted separately below.

| band | lexicon | WikiPron covers | agree (strict) | agree (lenient) | disagree |
|---|---:|---:|---:|---:|---:|
| all | 51,319 | 25,649 (50.0%) | 91.9% | 96.1% | 990 |
| prevalence ≥ 0 | 27,654 | 20,265 (73.3%) | 92.2% | 96.7% | 665 |
| prevalence < 0 | 1,074 | 714 (66.5%) | 84.5% | 87.1% | 92 |
| no prevalence row | 22,591 | 4,670 (20.7%) | 91.9% | 95.0% | 233 |

Of the 665 Answer-band disagreements, 25 are words where every WikiPron reading
is non-rhotic (an RP transcription leaking through the "US" file): Wiktionary's
side is wrong for our purposes. A seeded random sample of 50 of the other 640
was judged by hand:

| verdict | count | examples |
|---|---:|---|
| CMUdict wrong for General American | 14 | `furthest` (TH for /ð/), `pinot` (final T), `idealism` (drops a schwa), `biomass` (no secondary stress on *-mass*), `doughty` (AO for /aʊ/), `mowing` (AW for /oʊ/), `solely` (extra syllable), `coli`, `comparator`, `nobly`, `antipodes`, `endive`, `astrophysicist` (S for /z/), `gaga` |
| Wiktionary/WikiPron wrong or non-GA | 7 | four write a flapped /t/ as `d` (`elevated`, `diameter`, `psychosomatic`, `nonconformity`); `flax` as `flɛks`; `hedonic`; `strove` |
| Both are real GA variants | 22 | `semis` (/aɪz/ vs /iz/), `boatswain`, `grandma` (d-drop), `sequential` (/ʃ/ vs /tʃ/), `biannual` (yod), `mantilla`, `petrol` |
| My comparator's artefact | 7 | `aquarium` (glide `j` written in), `topiary` (`ɛəɹ`), `tile` (`taɪəl`), reduced `ʊ` vs `ə` |

So on the evidence of this sample:

- **Where a disagreement is a real error, it is CMUdict's about two times in
  three** (14 of 21), and the remaining Wiktionary errors are mostly one
  notational habit a normaliser can absorb.
- **CMUdict Rhyme Key errors in the Answer band:** 14/50 = 28% (Wilson 95%
  interval 17% to 42%) of 640, so roughly **110 to 270 words, central estimate
  180**, about 0.9% of the 20,265 compared. The 7,389 Answer-band words WikiPron
  does not cover are unchecked.
- **Stress errors are mostly invisible to this check.** WikiPron has no stress,
  so a reading with the right segments and the wrong stress passes. `biomass`
  surfaced only because its segments also differ. Stress is exactly where
  ADR-0010's stress promotion carries its measured error rate, so the check that
  matters for it needs Kaikki's stressed, tagged transcriptions.
- **Variants are the largest group.** Because a Submission rhymes on *any* of
  its Rhyme Keys, a Wiktionary variant CMUdict lacks is a missing reading, not a
  wrong one. Adding it is reading manufacture by another name, which ADR-0010
  and ADR-0011 gate on measured reach, so it belongs in the Candidate Queue for
  a judge rather than in an automatic merge.

Two by-products worth knowing: WikiPron holds 4,905 Answer-band words that
CMUdict lacks (some will already gain a reading from coverage derivation or the
supplement), and it covers 934 of the 7,436 words coverage derivation composes
a reading for, which is the set a derivation-rule audit could check
segmentally today.

## Knownness and Retrieval sources

| Source | What it measures | Recognition or production? | Size | Licence |
|---|---|---|---|---|
| Word prevalence (Brysbaert et al. 2019, in use) | Share of people who know the word | Recognition | 61,858 lemmas | Academic; commercial unconfirmed (ADR-0003) |
| SUBTLEX-US (Brysbaert & New 2009) | Frequency in US film and TV subtitles | Neither: exposure (speech that screenwriters produced) | 51 million words, 8,388 films, 74,286 words | No licence stated on the distribution page |
| Age-of-acquisition ratings (Kuperman et al. 2012) | Adults' estimate of when they learned a word | Recognition-type self report | 30,121 content words | No licence stated on the distribution page |
| Glasgow Norms (Scott et al. 2019) | Nine rated scales incl. familiarity and AoA | Recognition-type rating | 5,553 words | Article is CC BY (Europe PMC) |
| Small World of Words, English (De Deyne et al. 2019) | Free association: first words that come to mind for a cue | **Production**, semantic cue | Over 12,000 cues, multiple responses per cue | CC BY-NC-ND 3.0 |
| USF rhyme norms (Nelson, McEvoy & Schreiber) | First word written on hearing an ending sound | **Production, rhyme cue** | 397 ending sounds; responses limited to their 5,019-word set | "Copyright Nelson, McEvoy & Schreiber"; no licence stated |
| Norms for words that rhyme (Libkuman 1994) | As many rhymes as possible for a word in 30 seconds | **Production, rhyme cue** | 477 cue words, 545 subjects | Published tables in a paywalled article |
| wordfreq (Speer) | Blended frequency across eight corpora | Exposure | Snapshot to about 2021, "unlikely to be updated again" | Code Apache 2.0; data CC BY-SA 4.0 |

Sources: [SUBTLEX-US](https://www.ugent.be/pp/experimentele-psychologie/en/research/documents/subtlexus);
Kuperman et al., [doi:10.3758/s13428-012-0210-4](https://doi.org/10.3758/s13428-012-0210-4);
Scott et al., [PMC6538586](https://europepmc.org/article/PMC/PMC6538586);
De Deyne et al., [doi:10.3758/s13428-018-1115-7](https://doi.org/10.3758/s13428-018-1115-7) and the
[SWOW research page](https://smallworldofwords.org/en/project/research) for the licence;
[USF norms Appendix F](http://w3.usf.edu/FreeAssociation/AppendixF/index.html) and
Nelson, McEvoy & Schreiber (2004), [doi:10.3758/BF03195588](https://doi.org/10.3758/BF03195588);
Libkuman (1994), *Behavior Research Methods, Instruments, & Computers* 26(3), 278 to 322,
[doi:10.3758/BF03204638](https://doi.org/10.3758/BF03204638) (task and sizes from its abstract);
[wordfreq](https://github.com/rspeer/wordfreq).

Accent is irrelevant to knownness, but population is not: these samples differ
in country and era, and none was checked for it here.

### Measurement: does frequency catch the words editors moved to Bonus?

The `FreqZipfUS` column (SUBTLEX-US on the Zipf scale) already ships inside
`data/prevalence.csv`, so frequency costs nothing to try. Of the 111 words whose
final verdict in `data/tier-overrides.csv` is `bonus` (recognised, so prevalence
put them in the Answer band, but an editor judged nobody retrieves them), 105
have both a prevalence and a frequency figure. For each, I ranked its frequency
among all words within ±0.1 prevalence of it (mid-rank for ties).

- Median percentile **0.69** (quartiles 0.32 and 0.84); only 39% sit below their
  neighbourhood's median.
- 30% are at the frequency floor, against 48% of their neighbours.
- For ADR-0015's pair, frequency does order `readjust` above `misadjust`, the
  way Retrieval would; prevalence orders them the other way.

So one pair goes the right way, but across the population the words editors
demoted are *more* frequent than their prevalence peers, not less. Frequency is
not a second opinion on Retrieval for this population, which agrees with
ADR-0003's rejection of it as the primary axis. Aggregates only are reported
here, since ADR-0013 keeps the per-word figures out of public repositories.
Caveat: 105 words chosen by an editor reading daily Puzzles is a selected
sample, not a random one.

### What would measure Retrieval

Retrieval is production given a rhyme cue, and only the two rhyme-norm sets
collect exactly that. Both are small and old, and neither has a clear licence,
so they cannot be a per-word lever. They could be a **validation set** for
whatever proxy the loop uses: a proxy that files a word people produced within
30 seconds as a Bonus Word is wrong, and one that files a never-produced word as
an Answer is suspect. Small World of Words is production at scale, but the cue
is a meaning, not a sound, so it measures how accessible a word is in general,
which is closer to Retrieval than recognition is but still not the same thing.
Its no-derivatives clause fits a check whose output never ships and does not
fit anything committed.

## Licence consequences for a cross-check loop

- Pinned dumps stay in the uncommitted `data/`, recorded in `sources.json`, as
  the current inputs are.
- A cross-check that only *raises Candidates* ships nothing from the third-party
  data. A judge who then writes a `supplement.dict` line in ARPAbet is recording
  a pronunciation fact, not copying CC BY-SA text, but if Wiktionary material
  were ever committed or served verbatim, share-alike and attribution would
  apply (`THIRD-PARTY-NOTICES.md` already handles CMUdict's notice). This is a
  reading of the licences, not legal advice.
- Non-commercial terms (Unisyn, Small World of Words, prevalence itself) are
  fine for a hobby project today and are the same deferred risk ADR-0003
  records.

## Open questions

- The stressed comparison was not run. It needs the Kaikki dump (2.8 GB
  gzipped) filtered to English entries with `General-American` or `US` tags,
  which is the natural next measurement and the one that bears on ADR-0010.
- Whether Candidates from an automated cross-check should enter the Candidate
  Queue as a fourth capture path, and how a judge tells a variant from an error
  without a human, is design work for the map, not a data question.
- MFA's provenance (is it CMUdict underneath?) and Moby's accent were not
  checked.
