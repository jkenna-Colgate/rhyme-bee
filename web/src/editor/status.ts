/**
 * The status readout: whether the built Rhyme Index is stale, and whether the
 * files the Editor's Pass writes are committed (#162).
 *
 * ## Why status and not action
 *
 * Both halves answer a question the editor would otherwise have to *remember*
 * the answer to. "Is the day on screen reading off an artifact that predates the
 * verdicts I recorded an hour ago" and "did I commit last night's pass" are
 * facts about the disk, and a tool that shows them is strictly better than a
 * habit that recalls them. Neither grows a button: the editor commits and
 * deploys, in that order, after reading a diff — see `WRITTEN_GROUPS` below and
 * `web/editorStatusPlugin.ts` for why the tool reads git and never runs it.
 *
 * ## Why the shapes are declared here
 *
 * For the reason `AddSubmitResult` and `DemotionWriteResult` are: the browser
 * cannot import the module that assembles them — it stats files and spawns
 * `git` — and two declarations of one wire shape is exactly the pair that
 * drifts.
 */

/**
 * Whether the built artifact still answers for what is on disk.
 *
 * A mirror of `IndexStaleness` (`scripts/indexArtifact.ts`) with one deliberate
 * difference: `input` is **repo-relative**. The predicate deals in absolute
 * paths because its callers open the files; this one is read by a browser on
 * the other end of a socket, and an absolute path carries the developer's home
 * directory and username into a response for no gain at all. `data/demotions.txt`
 * is the whole of what the editor needs to be told.
 */
export interface IndexStatus {
  stale: boolean;
  /** Null only when the artifact is current. */
  reason: "no-artifact" | "missing-input" | "input-newer" | null;
  /** The input that settled it, repo-relative, when an input settled it. */
  input: string | null;
}

/**
 * What git says about one of the written files.
 *
 * Five cases rather than a boolean, because four of them are different advice.
 * `absent` is a file no pass has written yet, which is a legitimate resting
 * state for the Retrieval override layer (ADR-0015) and not something to
 * commit. `unknown` is git declining to answer — it is reported as its own case
 * rather than folded into `clean`, since "I could not ask" and "there is
 * nothing to commit" are the two readings a maintainer must never confuse.
 *
 * `ignored` is the case that earns its keep. `data/tier-overrides.csv` matched
 * the repository's blanket `*.csv` rule until this slice, so the one file in
 * the project that can never be regenerated was invisible to every `git add`
 * the maintainer would ever type — a night of Retrieval judgements silently
 * uncommittable. The rule is fixed in `.gitignore`, and this state stays so the
 * screen says so out loud if it ever recurs.
 */
export type WrittenFileState = "clean" | "uncommitted" | "ignored" | "absent" | "unknown";

export interface WrittenFileStatus {
  /** Repo-relative, forward slashes — the spelling `git status` prints. */
  path: string;
  state: WrittenFileState;
}

export interface EditorStatus {
  index: IndexStatus;
  /** One entry per path in `WRITTEN_FILES`, in that order. */
  written: WrittenFileStatus[];
}

/**
 * The files the Editor's Pass writes, in three groups.
 *
 * #162 calls them "the Retrieval override layer, the demotion list, and the
 * pronunciation supplement with its deferred queue" — three groups over four
 * paths, and the arithmetic is the point rather than a slip. The supplement and
 * the deferred queue are written by *one* act: `add` writes a reading to the
 * first or records the miss in the second, and every word in a batch lands in
 * exactly one of them. Committing one without the other leaves the record of a
 * pass half told, so they are one thing to commit and are shown as one heading
 * with both paths under it.
 *
 * Declared as a shared constant rather than assembled at either end, so the
 * endpoint's answer and the screen's headings cannot disagree about which files
 * the tool is accountable for.
 */
export interface WrittenGroup {
  /** The act, not the file: what writing these paths means. */
  title: string;
  /** Why it matters, for the screen. One sentence, in the domain's terms. */
  blurb: string;
  paths: readonly string[];
}

export const WRITTEN_GROUPS: readonly WrittenGroup[] = [
  {
    title: "Retrieval overrides",
    blurb: "Every Tier verdict the pass has recorded. It can never be regenerated.",
    paths: ["data/tier-overrides.csv"],
  },
  {
    title: "Demotions",
    blurb: "The words the pass took wordhood from — names, abbreviations, junk.",
    paths: ["data/demotions.txt"],
  },
  {
    title: "Pronunciation supplement",
    blurb: "The readings adds wrote, and the words no reading could be composed for.",
    paths: ["data/supplement.dict", "data/deferred-readings.jsonl"],
  },
];

/** Every written path, in the order the endpoint answers with. */
export const WRITTEN_FILES: readonly string[] = WRITTEN_GROUPS.flatMap((group) => [...group.paths]);

/**
 * Whether anything is waiting to be made real — the rule #162 widens.
 *
 * Before this slice, Submit was enabled by a queued add and nothing else, which
 * made a night of Tier judgements alone unfinishable from the browser: the
 * verdicts were on disk, the artifact predated them, and the only way to fold
 * them in was to queue a word the day did not need or to leave the tool and run
 * `npm run build:index` by hand. A stale index *is* pending work — rows written
 * since the last rebuild — so it enables Submit exactly as a queued add does.
 *
 * Stated as a function over two facts rather than read off the status inline,
 * because the button, the button's label and the endpoint's own refusal all
 * have to agree about what "pending" means, and three inline readings of it
 * would be three chances to disagree. The endpoint does not call this — it
 * cannot trust a browser's copy of a fact about the disk, and asks
 * `indexStaleness` itself — but it enforces the same sentence.
 *
 * A status that has not arrived yet counts as *not* stale, which is the
 * conservative direction: the worst it costs is a Submit that stays disabled
 * for the few milliseconds before the first status lands.
 */
export function pendingWork(queued: number, status: EditorStatus | null): boolean {
  return queued > 0 || (status?.index.stale ?? false);
}
