/**
 * The status panel: whether the built Rhyme Index is stale, and whether the
 * files the pass writes are committed (#162).
 *
 * It is drawn above the day rather than beside it or below it. Both facts are
 * about the whole repository and not about the date on screen — they do not
 * change when the editor jumps to Tuesday — and both are things to *notice on
 * arrival*: "last night's verdicts are still uncommitted" is worth meeting
 * before the first click of tonight's pass, not after scrolling past two
 * hundred words.
 *
 * **There is no button in here.** Not a commit, not a deploy, not a rebuild.
 * The rebuild has one already — Submit, one section down, which #162 widens to
 * fire on a stale index alone — and a second control that did the same thing
 * from a different place would be two answers to "how do I make this real".
 * Commit and deploy are absent because the sequence #162 protects is *judge,
 * read the diff, commit, deploy*: the diff is read outside this tool, in the
 * maintainer's own terminal, and a button here would be an invitation to skip
 * the step the whole ordering exists for.
 */

import {
  WRITTEN_GROUPS,
  type EditorStatus,
  type WrittenFileStatus,
  type WrittenGroup,
} from "./status.ts";

export function StatusView({ status, error }: { status: EditorStatus | null; error: string | null }) {
  return (
    <section className="editor-status">
      {error !== null && <p className="editor-write-failed">{error}</p>}

      {status === null ? (
        <p className="editor-muted">Reading the repository’s state…</p>
      ) : (
        <>
          <IndexLine status={status} />
          <div className="editor-status-files">
            {WRITTEN_GROUPS.map((group) => (
              <WrittenFiles
                key={group.title}
                group={group}
                files={status.written.filter((file) => group.paths.includes(file.path))}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Whether the artifact the day was read off still answers for what is on disk.
 *
 * The three stale reasons are said differently because they are different
 * situations with different remedies, and one sentence covering all of them
 * would be vague in the only case that is not routine. `input-newer` is the
 * ordinary end of an evening — verdicts written, index not yet rebuilt — and
 * names the file that settled it so the editor can tell "my own work" from "a
 * source I pulled". `no-artifact` is a repository with no Rhyme Index at all,
 * which is not staleness so much as absence, and Submit cannot fix it by
 * re-reading a day that will not read. `missing-input` is a setup step not yet
 * run, and the rebuild Submit fires will fail — so it says so rather than
 * offering the rebuild as the answer.
 */
function IndexLine({ status }: { status: EditorStatus }) {
  const { stale, reason, input } = status.index;

  if (!stale) {
    return (
      <p className="editor-status-index editor-status-fresh">
        <strong>Rhyme Index is current.</strong> The figures on this day are the built artifact’s.
      </p>
    );
  }

  return (
    <p className="editor-status-index editor-status-stale">
      <strong>Rhyme Index is stale.</strong>{" "}
      {reason === "no-artifact" ? (
        <>
          No index has been built in <code>dist-data/</code> at all. Run{" "}
          <code>npm run build:index</code> — until it has, no day can be read.
        </>
      ) : reason === "missing-input" ? (
        <>
          The build needs <code>{input}</code> and it is not there. Submit’s rebuild cannot supply
          it; see the pinned sources in <code>data/</code>.
        </>
      ) : (
        <>
          <code>{input}</code> has changed since the artifact was built, so this day is being read
          off an index that predates it. Submit folds it in.
        </>
      )}
    </p>
  );
}

/**
 * One group of written files, and what git says about each.
 *
 * The heading is the *act* — a Retrieval override, a demotion, a reading — and
 * the paths under it are what that act writes. The supplement's group holds two
 * of them because an add lands in exactly one: a reading in
 * `data/supplement.dict`, or the record of a miss in
 * `data/deferred-readings.jsonl`. They are one thing to commit and are shown as
 * one thing, with both paths visible so the editor knows what `git add` is
 * about to take.
 */
function WrittenFiles({ group, files }: { group: WrittenGroup; files: WrittenFileStatus[] }) {
  return (
    <div className="editor-status-group">
      <h3>{group.title}</h3>
      <p className="editor-muted">{group.blurb}</p>
      <ul>
        {files.map((file) => (
          <li key={file.path} className={`editor-status-file editor-status-${file.state}`}>
            <code>{file.path}</code> — <FileState state={file.state} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One file's state in a sentence.
 *
 * `unknown` is the case worth reading twice. It is git declining to answer —
 * not installed, not a repository, or killed on a timeout — and the tempting
 * shorthand of treating silence as "nothing to commit" would report a night of
 * unsaved Retrieval judgements as safely committed. So it says what it does not
 * know, which is the only honest thing a status panel can do with a question it
 * could not ask.
 */
function FileState({ state }: { state: WrittenFileStatus["state"] }) {
  switch (state) {
    case "clean":
      return <>committed — nothing waiting.</>;
    case "uncommitted":
      return (
        <>
          <strong>uncommitted changes.</strong> Read the diff and commit before deploying.
        </>
      );
    case "ignored":
      return (
        <>
          <strong>ignored by git</strong> — a rule in <code>.gitignore</code> matches it, so no{" "}
          <code>git add</code> will ever take it and this work cannot be committed at all.
        </>
      );
    case "absent":
      return <>not written yet.</>;
    case "unknown":
      return (
        <>
          <strong>unknown</strong> — git could not be asked, so this may or may not be committed.
        </>
      );
    default: {
      const exhaustive: never = state;
      throw new Error(`unreachable file state: ${String(exhaustive)}`);
    }
  }
}
