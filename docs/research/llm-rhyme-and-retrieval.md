# LLM rhyme judgement and word production versus human Retrieval

Research for [How well do LLMs judge rhyme, and how closely does their word production track human retrieval?](https://github.com/jkenna-Colgate/rhyme-bee/issues/220),
on the map [Wayfinder: run the game unattended at a Playability Bar](https://github.com/jkenna-Colgate/rhyme-bee/issues/218).
Written 2026-09-29. Every number below is taken from the cited source; where a
source was only read in part, that is said.

## Short answer

1. **LLMs are mediocre pronouncers and lenient-graded rhymers.** The best 2024
   models transcribe a word to IPA exactly right about half the time (52% on
   frequent words, 40% on rare ones), below a plain dictionary-plus-neural G2P
   library (62% and 53%). On producing rhymes they trail humans by about 17
   points, and the gap widens on rare cue words. Even those rhyme scores are
   graded against a rhyming dictionary that counts slant rhymes, so they
   overstate accuracy under this game's strict, one-accent rule. The failures are
   systematic: rare words, words the tokeniser splits, and syllable structure.
   No published study tests accent-specific judgements such as the cot-caught
   merger, or eye-rhyme traps such as `chocolate` and `ate`.
2. **The evidence doesn't show over-retrieval. It shows homogenisation.** When
   the number of responses is fixed to match humans, LLM "participants" produce
   far fewer distinct words than a human sample, converge on the same top items,
   and stay that way across models, personas and temperatures. The worry that an
   LLM thinks of words no person would has not been measured for rhyme. The
   adjacent evidence points the other way for any single sample. Over-retrieval
   is a real risk only where the model sets its own stopping point, and that is
   under the prompt's control.
3. **Published human rhyme norms exist and fit the job better than Small World of
   Words.** Libkuman (1994) has 545 people producing as many rhymes as they can
   in 30 seconds for 477 cue words, with the percentage of people producing each
   rhyme. The USF norms have first-word responses to 397 spoken rhyme sounds.
   Small World of Words is semantic free association, so it can't calibrate rhyme
   production, though its LLM replica shows how a calibration study is run. The
   rhyme norms can calibrate the *shape* of a Synthetic Player's output (which
   words, how concentrated, how many in a short window). They can't calibrate its
   *level*, because they are timed, 1990s undergraduates writing on paper, and
   the game is untimed.

## 1. Judging rhyme and pronouncing words

### What has been measured

**PhonologyBench** (Suvarna, Khandelwal & Peng, KnowLLM workshop at ACL 2024;
[arXiv 2404.02456](https://arxiv.org/abs/2404.02456)) is the main English
benchmark. Three tasks, all zero-shot:

- **Grapheme-to-phoneme (G2P).** 3,000 American English words from the
  SIGMORPHON 2021 G2P task, answered in IPA and scored as exact match. Word
  frequency comes from document counts in C4. Accuracy, frequent words / rare
  words: GPT-4 51.9 / 38.1, Claude-3-Sonnet 52.7 / 40.2, GPT-3.5 47.6 / 34.4,
  best open model (Mixtral-8x7B) 22.0 / 18.1. The `g2p` library baseline
  (dictionary lookup plus a neural net) scored 62.4 / 52.8.
  ([Table 2, v2 HTML](https://arxiv.org/html/2404.02456v2))
- **Tokenisation.** Among frequent words, those the OpenAI tokeniser keeps
  whole were transcribed more accurately than those split into sub-word pieces:
  Claude-3-Sonnet 64.8 vs 47.3, GPT-4 58.0 vs 49.2 (Table 3). Only 30% of the
  frequent words were single tokens.
- **Rhyme word generation.** 300 cue words (200 common, 100 rare), prompt "Give 5
  words that rhyme with X". Success rate is the share of the five that appear in
  a gold set scraped from WordHippo, which includes "slant and strict rhymes" and
  averages about 1,200 words per cue. Common / rare: GPT-4 69.1 / 46.1, GPT-3.5
  66.5 / 42.7, Claude-3-Sonnet 62.4 / 39.6, Mixtral 38.4 / 17.5, humans 86.4 /
  60.4 (Table 5). Fine-tuning Llama-2-13B on the common words did not help on
  the rare ones (15.8 on both).
- **Syllable counting** in sentences: best model 55% (Claude-3-Sonnet) against a
  human baseline of 90%. Open models did worse than counting vowel letters.
- **Stated limitation.** The benchmark covers American English only and "does
  not extend to various dialects".

**P-CoT** (Jang, Ahn & Shin, Findings of ACL 2025;
[arXiv 2507.16656](https://arxiv.org/abs/2507.16656)) re-ran PhonologyBench on
12 newer models. The rhyme success rates at baseline were Claude 3.5 Sonnet
76.4, GPT-4o 73.0, Llama-3.3-70B 66.3. A structured "pedagogical"
chain-of-thought prompt raised them to about 83 to 86, against the 86.4 human
reference. Few-shot G2P lifted Claude 3.5 Sonnet from 51.6 to about 80 on
frequent words, but only from 35.5 to about 61 on rare ones. The authors report
few-shot examples alone as giving "inconsistent gains". The prompt, not the
model, is a large part of the accuracy.

**Tokenisation as a cause.** Liao & Shi
([arXiv 2604.17105](https://arxiv.org/abs/2604.17105), April 2026) probed the
hidden states of models up to Llama-3.1-8B. Sub-word tokenisation weakens the
encoding of rhyme and syllable structure, and inserting character delimiters
raised GPT-2's layer-wise perfect-rhyme detection from about 61 to 66% up to 72
to 79%. This is a probing study of small models, not a test of prompted frontier
models, but it names the mechanism behind PhonologyBench's whole-word and
split-word gap. It agrees with the older result that character-level models
(ByGPT5; Belouadi & Eger, ACL 2023,
[arXiv 2212.10474](https://arxiv.org/abs/2212.10474)) hold rhyme constraints
better than sub-word models.

### Where the failures fall, for this game

| Failure | Evidence | Why it matters here |
|---|---|---|
| Rare words | G2P drops 11 to 13 points and rhyme generation 20 to 24 points from common to rare cues (PhonologyBench); few-shot helps rare words least (P-CoT) | Bonus Words and long rare Answers are exactly where an LLM judge is least reliable, and they carry the most points |
| Tokeniser splits | Whole-word vs split-word G2P gap of up to 17 points (PhonologyBench); probing gap (Liao & Shi) | Long, derived and prefixed words (the Shadow Key and Retrieval problem words) are the ones that get split |
| Syllables and stress | Syllable counting far below humans (PhonologyBench); no stress-specific measurement found | The Rhyme Key starts at the last stressed vowel, and secondary stress (`IM-preg-nate`) qualifies, so a stress error changes the verdict |
| Lenient benchmarks | Rhyme gold sets include slant rhymes (PhonologyBench, P-CoT) | Published rhyme accuracy is an upper bound for strict rhyme; no benchmark scores rhymes the way this game does |
| Accent | No study found; PhonologyBench explicitly excludes dialects | Nothing published says whether a model applies the cot-caught merger, or which accent it assumes |
| Spelling over sound | Documented in humans (rhyme judgements are slower and less accurate when spelling conflicts with sound); no LLM study found | Eye rhymes (`chocolate`/`ate`) and hidden rhymes (`eight`/`ate`) are the game's teaching example, and an orthographic bias would be in the same direction as the human one |

**Gap.** No published work asks current frontier or reasoning models a binary
"do X and Y rhyme in General American?" question and scores it against a
pronunciation dictionary. The repo can measure this itself, and more cheaply than
any paper: the Rhyme Index already is the ground truth the game adjudicates
against.

## 2. Producing words like a person

### LLM output is less diverse than human output, not more

- **Phonemic fluency** (the closest published task to rhyme production, since
  both retrieve by word form). Qiu, Brisebois & Sun,
  [arXiv 2505.16164](https://arxiv.org/abs/2505.16164) (v2, February 2026),
  compared 106 people naming F-words for one minute (mean 16.89 words) with 34
  models in 45 configurations, each told the participant's age, education and
  target count. Most models hit the count. No model matched human variability:
  the best (Claude 3.7 Sonnet) produced 226 distinct words against the humans'
  476, and newer or "thinking" configurations *reduced* variability. LLM word
  distributions had steeper Zipf slopes (α 1.19 to 1.53 against 0.89), meaning
  the top words dominate. Ensembles of 1,000 simulated runs across models
  reached only 179 distinct words, because any two models share about 74% of
  their vocabulary. Human choices tracked word frequency (r = 0.55) and age of
  acquisition (r = −0.52). Models tracked these more weakly, though Claude 3.7
  Sonnet came close.
- **Free association.** The LLM World of Words (Abramski, Improta, Rossetti &
  Stella, *Scientific Data* 2025; [arXiv 2412.01330](https://arxiv.org/abs/2412.01330))
  re-ran the Small World of Words protocol on its roughly 12,000 cues with
  Mistral, Llama 3 and Claude Haiku, 100 runs of three responses each. Distinct
  responses: humans 116,640, Llama 3 105,367, Mistral 41,369, Haiku 15,275.
  Networks shared 48 to 59% of nodes but only 13 to 23% of edges with the human
  network.
- **Semantic fluency.** Paris-Colombo, Cabral-Carvalho & Toro-Hernández
  ([arXiv 2607.12195](https://arxiv.org/abs/2607.12195), July 2026; abstract
  read only): GPT-4o, Gemini 2.5 Pro and Claude Sonnet 4.5 on animal naming,
  across eight temperatures. Humans showed "higher entropy, larger semantic
  steps and broader dispersion than all LLMs", and "no configuration reproduced
  the complete human profile".
- **Simulated participants generally.** Park, Schoenegger & Zhu (*Behavior
  Research Methods* 2024; [arXiv 2302.07267](https://arxiv.org/abs/2302.07267))
  named the "correct answer" effect: repeated runs collapse to one answer with
  near-zero variance, and changing the stated demographics doesn't fix it. Trott
  ("Large Language Models and the Wisdom of Small Crowds", *Open Mind* 2024,
  [doi:10.1162/opmi_a_00144](https://doi.org/10.1162/opmi_a_00144)) found that a
  GPT-4 dataset is worth more than one human participant but fewer than a small
  crowd (two or more people beat it on every one of four English
  psycholinguistic datasets). LLMs approximate the crowd's average and miss the
  individual spread.

### Does the model "think of" words no person would?

This has not been measured for rhyme, and the design question comes down to
the stopping rule:

- **With the count fixed** (Qiu et al.; PhonologyBench's "give 5"), the evidence
  says the LLM goes for the *head* of the distribution and does it more
  uniformly than people do. A crowd of Synthetic Players would then overstate
  how often the common Answers get found and understate how differently players
  spread across the rest.
- **With no count fixed** ("list every rhyme you can"), a model can recite a
  rhyming dictionary from memory. PhonologyBench shows what that tail is like:
  on rare cues fewer than half of GPT-4's rhymes were even slant rhymes. So an
  unbounded Synthetic Player over-retrieves *and* produces non-rhymes and
  non-words, which would register as False Accept probes and Trust noise rather
  than play.

Knownness estimates from LLMs don't close the Retrieval gap either. Brysbaert,
Martínez & Reviriego (*Behavior Research Methods* 2025,
[doi:10.3758/s13428-024-02561-7](https://doi.org/10.3758/s13428-024-02561-7))
show that LLM *familiarity* ratings for more than 400,000 English words and
phrases predict lexical decision better than frequency counts. Familiarity,
though, is a recognition measure, the same side of the gap as word prevalence.
It would give the same answer on the ranking inversion ADR-0015 describes.
Trott (*Behavior Research Methods* 2024,
[doi:10.3758/s13428-024-02337-z](https://doi.org/10.3758/s13428-024-02337-z))
likewise finds GPT-4 ratings correlate with human norms, from 0.39 to 0.86
depending on the norm, with systematic departures.

### Human rhyme-production norms that exist

**Libkuman (1994), "Norms for words that rhyme"**, *Behavior Research Methods,
Instruments, & Computers* 26, 278 to 322
([doi:10.3758/BF03204638](https://doi.org/10.3758/BF03204638), free PDF from
Springer). This is the calibration target that fits best.

- 545 Central Michigan University undergraduates, 477 cue nouns, roughly 40 to
  54 people per cue. The examiner pronounced each cue aloud, and people wrote
  as many rhymes as they could in 30 seconds.
- Non-words, non-rhymes and rhymes on a *minor* (secondary) stress were
  excluded. Minor-stress rhymes were dropped because they "are not perceived as
  rhymes by most people". This is stricter than the game, which accepts
  secondary stress.
- Mean 2.64 rhymes per cue per person (median 2.45). Overlap, meaning how far
  people produce the same words, has mean 0.27.
- Appendix B lists every rhyme produced for every cue, with the percentage of
  people who produced it and its word frequency. For example, for `fight` (49
  people, 32 distinct rhymes): `sight` 83%, `light` 73%, `might` 71%,
  `night` 61%, down to a long tail of words one person produced (`smite`,
  `sprite`, `trite`: 2% each). Multi-syllable cues collapse: `garden` produced
  only `harden` (63%) and `pardon` (42%), `forest` three words, `freedom` none.
- **The rhyme set is retrieved through the sound, not the cue word.** For 89
  cue pairs that rhyme with each other, 85% of the words produced were common to
  both cues. This is what lets norms collected for one word calibrate a whole
  Rhyme Key.
- People did not produce rhymes in order of frequency. Later responses were, if
  anything, *more* frequent words by Kučera-Francis counts. The author suggests
  another strategy, such as an alphabetical onset search, comes first, which
  fits the game's own claim that retrieval is not recognition-ordered.

**USF Free Association, Rhyme, and Word Fragment Norms** (Nelson, McEvoy &
Schreiber, *BRMIC* 2004, [doi:10.3758/BF03195588](https://doi.org/10.3758/BF03195588);
[Appendix F](http://w3.usf.edu/FreeAssociation/AppendixF/index.html)). 397
spoken *ending sounds* (130 single rhymes such as `EST`, 144 double rhymes such
as `A'BER`) were read aloud to samples of 153 to 242 people, who wrote the first
word to come to mind. It records how many different words each sound produced
and the probability of each, e.g. `EST` gave 20 different words and `best` 38%
of the time. Test-retest reliability averaged r = .79. This is first-response
only, and only words in the 5,019-word USF database are listed, so it captures
the head of the distribution and not the tail.

**Small World of Words** (De Deyne, Navarro, Perfors, Brysbaert & Storms,
*BRM* 2019, [doi:10.3758/s13428-018-1115-7](https://doi.org/10.3758/s13428-018-1115-7)):
12,000+ cues, 100 people per cue giving three responses each, 50% American
English speakers. It is a *semantic* free-association task ("the first three
words that came to mind"), so it doesn't calibrate rhyme production. Its use
here is methodological: the LLM World of Words shows the template for a
calibration study (same cues, same protocol, compare distinct-response counts
and network overlap).

## 3. What a Synthetic Player needs before anything trusts it

### Keep the LLM out of adjudication

The engine judges every Submission. An LLM should only be trusted with the one
judgement the engine can't make: whether a word the engine *rejected* is a
genuine rhyme (a Trust failure). There the LLM is at its weakest (rare words,
split tokens, stress, no accent evidence), so:

- Treat an LLM's "that's a real rhyme" as a Candidate for the Editor's Pass
  machinery, never as a finding by itself. That is how the game already treats
  a player's Appeal.
- Before its rate of Trust failures is reported as a number, measure the LLM
  judge against the Rhyme Index on a labelled set built to include the known
  hazards: eye rhymes, hidden rhymes, secondary-stress rhymes, cot-caught pairs,
  rare words and long prefixed or derived words. Report agreement by category,
  not as one figure.
- Make it reason from an explicit transcription (the P-CoT result: structured
  prompts are worth 10 to 20 points), and compare that transcription with the
  CMUdict reading. Disagreements are the interesting output.

### Calibrate production against Libkuman, then add the untimed part

1. **Match cues by Rhyme Key.** Because the rhyme set is accessed through the
   sound (85% commonality), any Libkuman cue whose Rhyme Key is also a Seed Word's
   Rhyme Key can be used. The appendix is a scanned table (the text layer has
   OCR errors such as `SUIl` for `Sun`), so extracting it takes one careful
   pass.
2. **Run a crowd, not a player.** For each matched Key, sample about 50
   independent Synthetic Players, each capped at about Libkuman's per-cue mean
   count, and vary persona and temperature. Compare with the human columns:
   - rank correlation of per-word production percentages;
   - distinct words across the crowd (total set size);
   - overlap (Libkuman's mean-over-set-size);
   - **tail mass**: the share of synthetic output that no human in the norms
     produced. This number measures over-retrieval directly.
3. **Expect under-dispersion and correct for it explicitly.** On all the evidence
   above, the crowd will be too uniform. Per Trott, a synthetic crowd is worth a
   few humans, not one per run, so Reachability estimates should carry that
   discount, or be built by resampling toward the human distribution rather than
   by counting synthetic runs as players.
4. **The untimed game is beyond what the norms cover.** Thirty seconds on paper
   is a floor on what a player finds in an untimed game. The norms calibrate
   *which* words come first and how concentrated they are. How far down the
   tail a patient player gets has no published human anchor, and would need the
   game's own playtest Sessions, or a stated assumption.
5. **Use USF first responses as a cheap second check** on the head of the
   distribution: does the Synthetic Player's first word match the human modal
   first word for that rhyme sound?

### Could published norms serve as the calibration?

Partly. The Libkuman and USF norms can validate the *shape* of Synthetic Player
production (which Answers are found, how concentrated, how many in a short
window) for the Rhyme Keys they cover. That is enough to detect both
over-retrieval (tail mass) and homogenisation (set size, overlap). They can't
set the *level* for an untimed player, they predate the game's vocabulary by
three decades, they cover a few hundred cues that are mostly common
one-syllable nouns, and they score secondary-stress rhymes out. Small World of
Words can't serve as rhyme calibration at all. No published norms exist for
rhyme *judgement* in General American, so that calibration has to come from the
Rhyme Index itself.

## Sources

- Suvarna, Khandelwal & Peng (2024). PhonologyBench. KnowLLM @ ACL 2024. [arXiv 2404.02456](https://arxiv.org/abs/2404.02456), [ACL Anthology](https://aclanthology.org/2024.knowllm-1.1/)
- Jang, Ahn & Shin (2025). P-CoT. Findings of ACL 2025. [arXiv 2507.16656](https://arxiv.org/abs/2507.16656)
- Liao & Shi (2026). How Tokenization Limits Phonological Knowledge Representation in Language Models. [arXiv 2604.17105](https://arxiv.org/abs/2604.17105)
- Belouadi & Eger (2023). ByGPT5. ACL 2023. [arXiv 2212.10474](https://arxiv.org/abs/2212.10474)
- Qiu, Brisebois & Sun (2026). Can LLMs Simulate Human Behavioral Variability? A Case Study in Phonemic Fluency. [arXiv 2505.16164](https://arxiv.org/abs/2505.16164)
- Abramski, Improta, Rossetti & Stella (2025). The "LLM World of Words" English free association norms. *Scientific Data*. [arXiv 2412.01330](https://arxiv.org/abs/2412.01330)
- Paris-Colombo, Cabral-Carvalho & Toro-Hernández (2026). Comparing Semantic Navigation in Humans and Large Language Models. [arXiv 2607.12195](https://arxiv.org/abs/2607.12195) (abstract only)
- Park, Schoenegger & Zhu (2024). Diminished diversity-of-thought in a standard large language model. *BRM*. [arXiv 2302.07267](https://arxiv.org/abs/2302.07267)
- Trott (2024). Large Language Models and the Wisdom of Small Crowds. *Open Mind*. [doi:10.1162/opmi_a_00144](https://doi.org/10.1162/opmi_a_00144)
- Trott (2024). Can large language models help augment English psycholinguistic datasets? *BRM*. [doi:10.3758/s13428-024-02337-z](https://doi.org/10.3758/s13428-024-02337-z)
- Brysbaert, Martínez & Reviriego (2025). Moving beyond word frequency based on tally counting: AI-generated familiarity estimates. *BRM*. [doi:10.3758/s13428-024-02561-7](https://doi.org/10.3758/s13428-024-02561-7)
- Libkuman (1994). Norms for words that rhyme. *BRMIC* 26, 278 to 322. [doi:10.3758/BF03204638](https://doi.org/10.3758/BF03204638)
- Nelson, McEvoy & Schreiber (2004). The University of South Florida free association, rhyme, and word fragment norms. *BRMIC* 36, 402 to 407. [doi:10.3758/BF03195588](https://doi.org/10.3758/BF03195588); [Appendix F](http://w3.usf.edu/FreeAssociation/AppendixF/index.html)
- De Deyne, Navarro, Perfors, Brysbaert & Storms (2019). The "Small World of Words" English word association norms. *BRM* 51, 987 to 1006. [doi:10.3758/s13428-018-1115-7](https://doi.org/10.3758/s13428-018-1115-7)
