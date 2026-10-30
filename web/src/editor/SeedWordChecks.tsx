/**
 * The Seed Word test on each scheduled day whose Seed Word was just given a
 * reading (#264), by an add or by a correction. Its own module because both
 * panels show it and `AddQueueView` already imports `CorrectionView`.
 *
 * It says what the day would become and nothing more: the Schedule is changed
 * by the Seed Word run, on the repair path every other day goes through, so the
 * command that does it is named rather than run here. That run repairs only a
 * day that fails the test, so naming it can move no other day.
 */

import type { ScheduledSeedWordCheck } from "../../../src/seedWord.ts";

export function SeedWordChecks({ checks }: { checks: ScheduledSeedWordCheck[] | null }) {
  if (checks === null) {
    return (
      <p className="editor-write-failed">
        A reading was written to a scheduled Seed Word, but the Seed Word test could not run on the
        rebuilt index. Run <code>npm run build:index</code>, then <code>npm run seeds:test</code>.
      </p>
    );
  }
  if (checks.length === 0) return null;
  return (
    <ul className="editor-seed-word-checks">
      {checks.map((check) => (
        <li key={check.date} className={check.passes ? "editor-reach" : "editor-write-failed"}>
          <strong>{check.date}</strong>, Seed Word <strong>{check.seed}</strong>: {check.line}{" "}
          {!check.passes && (
            <>
              {check.next === null
                ? "No word of its family passes, so the day would be Free Play."
                : `The day would keep ${check.rhymeKey} and go to ${check.next}.`}{" "}
              Run <code>npm run seeds:test -- --write</code> to write it; it repairs the days that
              fail the test and moves no other.
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
