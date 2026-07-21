# Responsive web, and player input is never silently transformed

The game ships as responsive web rather than native mobile. Mobile text input is treated as a **correctness** concern, not a styling one: autocorrect, autocapitalise and spellcheck are disabled on the submission field, and what the player typed is never silently altered.

## Why this is not a detail

This game's peak moment is a player typing a long, rare word. Mobile autocorrect exists to replace unusual strings with common ones, so it targets exactly the words the game rewards most. A player who thinks of `objurgate` and has iOS silently substitute `obligate` has had the best moment in the game stolen by the keyboard, and will blame the game. Spelling Bee does not have this problem — its answers are short and common, and the keyboard is on its side.

## Consequences

- `autocorrect="off" autocapitalize="off" spellcheck="false"` on the input. A future contributor may read this as a nicety and re-enable it; it is not.
- Web also means a contentious puzzle can be fixed the same day rather than waiting on app-store review. Given that this game's adjudication is inherently arguable, that matters more here than for most games.
- Rejections must state a **reason**. A bare "no" against a pronunciation the player cannot inspect reads as a bug — particularly for near-misses like `commensurate` (which ends in an unstressed schwa) and for proper nouns like `Kate` (which obviously rhymes). Default to a plain-English respelling — *"we say it kuh-MEN-suh-rit"* — with audio available on tap. No IPA anywhere: handing a player a symbol they cannot decode while telling them they are wrong is worse than saying nothing.
