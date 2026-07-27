# Supplement judge: turning play-test candidates into supplement entries

When play-testing surfaces a word the game *should* have accepted, the dev-only
"should count" button queues it in `data/supplement-candidates.jsonl`. This is
the decision tree for judging that queue and formatting the survivors into the
committed override layer, `data/supplement.dict` (ADR-0009).

The guiding rule is ADR-0009's: **fairness, not completeness**, and a stress
change is a rhyme-verdict change, so stay deliberate. When you are genuinely
unsure, **defer to the maintainer** — never invent a stress you cannot defend.

## 1. Gather the evidence

```
npm run supplement:candidates
```

For each candidate this prints: its Seed and **target Rhyme Key** (what it must
rhyme with), why the engine rejected it, its wordhood/name status, any direct
CMUdict reading, and its inflectional relatives that CMUdict holds with their
Rhyme Keys. Judge from this; the script decides nothing.

## 2. Decide each candidate

Walk these in order; the first that applies wins.

1. **It's a name** (`names.txt` says yes) → **reject**. The supplement never
   launders a proper noun into a word (CONTEXT.md); leave it out and note why.
2. **It's already in CMUdict** (a direct reading is shown) → this is a
   **correction**, almost always a stress fix. Find the reading whose stress
   misplaces the Rhyme Key, and author a single corrected reading whose **last
   primary-or-secondary vowel** lands on the syllable a General American speaker
   hears (e.g. `viceroy` `OY0`→`OY2`, `bratwurst` `ER0`→`ER2`). The entry
   *overrides* the upstream reading. If the current reading already rhymes on the
   target, the rejection was about wordhood, not stress — see step 4.
3. **It's absent from CMUdict but an inflection carries a usable reading** →
   **derive** the reading from that inflection. This is the morphology rule:
   - Take a relative CMUdict holds (`overjoy` absent, `overjoyed`
     `OW2 V ER0 JH OY1 D` present).
   - Strip the phonemes the inflection *adds* (the `-ed` here is the final `D`),
     leaving the lemma's reading (`overjoy` → `OW2 V ER0 JH OY1`).
   - Confirm that stem's Rhyme Key **equals the target** (`OY` rhymes with `joy`).
     If it does, that derived reading is the add. Common suffix→phoneme strips:
     `-s`→`S`/`Z`, `-ed`→`D`/`T`/`IH0 D`, `-ing`→`IH0 NG`. The mapping needs
     judgement (voicing, the `-ed` schwa after `t`/`d`) — that's why this is a
     human/agent call, not a script.
4. **It's a plausible word with no reading and no usable inflection** →
   **hand-author** an ARPAbet reading with stress, if you can defend it against a
   pronunciation you'd stake the rhyme verdict on. Otherwise **defer**.
5. **Anything borderline** — an uncertain stress, a word you're not sure is real,
   a derivation whose stem key doesn't cleanly match the target → **defer**.
   Collect the deferrals and hand them to the maintainer rather than committing a
   guess.

Every add carries **no prevalence**, so it tiers as a **Bonus Word** (ADR-0009);
scoring adds as Answers waits on #56.

## 3. Format and verify

- Append each survivor to `data/supplement.dict` as CMUdict text
  (`word  P1 P2 …`), with a `#` comment above it naming the source candidate and
  the reasoning (which inflection it derived from, or which stress it corrected).
- Rebuild and confirm each judged word now adjudicates against **its captured
  seed** — the add/correction rhymes, and a guardrail like `chocolate` vs `ate`
  still does not:
  ```
  npm run build:index
  ```
- Archive the judged queue so it isn't re-judged:
  ```
  npm run supplement:candidates -- --archive
  ```
- Report what you added, what you corrected, and — separately — **what you
  deferred and why**, so the maintainer can rule on the borderline cases.
