/**
 * Pure parser for the `npm run supplement:candidates` flags, in the style of
 * `playArgs.ts` — the one piece of the script worth testing apart from its
 * imperative shell. Accepts both spellings of each flag:
 *
 *   --words ule,rule,fluke --target "UW L"      # space-separated
 *   --words=ule,rule,fluke --target="UW L"      # equals form
 *
 * Both are parsed identically here, and neither rescues a
 * `npm run supplement:candidates --` on Windows PowerShell, where the separator
 * is eaten before npm sees it and the flags that follow are read as npm's own
 * configuration. This script fares worse than `play` there: both flags vanish
 * outright rather than leaking a stray value, so the run silently falls back to
 * queue mode. Quote the separator, or invoke tsx directly:
 *
 *   npx tsx scripts/supplement-candidates.ts --words "ule,rule" --target "UW L"
 *
 * Two modes, mutually exclusive:
 *
 *   - queue mode (the default): judges the captured candidate queue, same as
 *     always. `--archive` moves the judged queue aside afterward.
 *   - word-list mode (`--words` + `--target`, both required together): judges
 *     a maintainer-supplied word list against one target Rhyme Key that
 *     applies to all of them (#70's family-sweep case). There is no queue
 *     entry to archive in this mode, so `--archive` is rejected alongside it.
 *
 * Throws on any invalid input; the script turns the throw into a clean exit.
 */

export interface WordListArgs {
  words: string[];
  target: string;
}

export interface CandidatesArgs {
  archive: boolean;
  wordList: WordListArgs | null;
}

export function parseCandidatesArgs(argv: string[]): CandidatesArgs {
  let archive = false;
  let words: string[] | null = null;
  let target: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    const eq = token.indexOf("=");
    const flag = eq === -1 ? token : token.slice(0, eq);
    const inline = eq === -1 ? undefined : token.slice(eq + 1);

    if (flag === "--archive") {
      archive = true;
    } else if (flag === "--words") {
      const value = inline ?? argv[++i];
      if (value === undefined || value === "") {
        throw new Error("--words needs a comma-separated list, e.g. --words=ule,rule,fluke");
      }
      words = value
        .split(",")
        .map((w) => w.trim())
        .filter((w) => w !== "");
    } else if (flag === "--target") {
      const value = inline ?? argv[++i];
      if (value === undefined || value === "") {
        throw new Error('--target needs a Rhyme Key, e.g. --target="UW L"');
      }
      target = value;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (words !== null && target === null) {
    throw new Error("--words needs --target too — the Rhyme Key every supplied word is judged against.");
  }
  if (target !== null && words === null) {
    throw new Error("--target needs --words too — supply the word list it applies to.");
  }
  if (archive && words !== null) {
    throw new Error("--archive only applies to the queue (no --words/--target) — there is nothing queued to archive from a supplied word list.");
  }

  return {
    archive,
    wordList: words !== null && target !== null ? { words, target } : null,
  };
}
