# Scoring is length-dominant with a flat rare bonus; Rank is a percentage of maximum Answer Score

An Answer scores on its **length**, plus a small **flat bonus** when it is rare —
`score(answer) = length + (isRare ? RARE_BONUS : 0)`, default `RARE_BONUS = 2`.
"Rare" is a fixed line on the knownness scale (`RARE_KNOWNNESS_CUTOFF`, default
`0.7`): an Answer is rare when its word-prevalence sits below the cutoff, so
rareness is a property of the word, not of the Puzzle it lands in. Bonus Words
score nothing. **Rank** is the player's Score as a percentage of the Puzzle's
maximum achievable Answer Score, mapped onto an ordered ladder of named tiers.

## Why a flat bonus and not a knownness gradient

The knownness data is a continuous scale (roughly −2 to +2.5), so the obvious move
is to scale each Answer's points by how rare it is. We rejected that. A gradient is
**opaque**: no player can look at a word and predict what it scored, so the number
on the screen stops meaning anything they can reason about. The flat rule is
predictable — *letters are points, and a rare word is worth two more* — and a
player can hold the whole scoring model in their head. We are buying legibility at
the cost of fidelity, deliberately.

This reverses an earlier **strict-dominance** recommendation, where length was to
dominate rarity absolutely (a longer word always outscores a shorter one). The
flat bonus makes dominance **soft**: length is still the primary driver, but a much
rarer short word can occasionally edge past a slightly longer common one. That
small surprise is worth keeping — it rewards knowing the rare word — and it stays
predictable because the bonus is a fixed amount, not a curve.

`RARE_KNOWNNESS_CUTOFF` and `RARE_BONUS` are configuration and are expected to be
tuned against real play; `0.7` was chosen because it marks roughly the least-known
fifth of Answers as rare on the shipped dataset and keeps the flagship word
`defenestrate` (knownness 0.25) comfortably rare.

## Why Rank is a percentage of the maximum, not an answer count

Rank is `Score ÷ maxAnswerScore`, not "answers found ÷ total answers." Percentage
of the maximum **self-normalises across Puzzle sizes**: a 25-Answer Puzzle and a
110-Answer Puzzle both top out at 100%, so the same ladder of named tiers works for
every Puzzle without retuning (the property ADR-0004 leans on when it widens the
size band). Because every Answer contributes positive points, 100% of the maximum
is reachable only by finding every Answer — so the top "all Answers found" tier
falls out of the same "highest rung at or below the current percentage" rule with
no special case. The top *named* tier is deliberately gated well below 100% so it
is a realistic goal, not a demand for perfection.
