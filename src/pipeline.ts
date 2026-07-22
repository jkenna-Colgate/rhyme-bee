/**
 * Parsing helpers for the offline build pipeline. Each turns a pinned raw input
 * into the shape the index needs. Kept separate from file IO so they are
 * testable without the (uncommitted, large) data files.
 */

import { normaliseWord } from "./cmudict.ts";

/** One token per line, `#` comments and blanks ignored, lower-cased. */
export function parseWordList(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    out.add(normaliseWord(line));
  }
  return out;
}

/** Column headers in the Brysbaert prevalence CSV. */
const WORD_COLUMN = "Word";
const PREVALENCE_COLUMN = "Prevalence";

/**
 * Parse the word-prevalence norms as CSV with a header naming a word column and
 * a prevalence column. Returns lemma -> score. Rows with an unparseable score
 * are skipped rather than defaulted, so a bad row never masquerades as data.
 */
export function parsePrevalenceCsv(text: string): Map<string, number> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const out = new Map<string, number>();
  if (lines.length === 0) return out;

  const header = splitCsvRow(lines[0]!);
  const wordCol = header.indexOf(WORD_COLUMN);
  const prevCol = header.indexOf(PREVALENCE_COLUMN);
  if (wordCol === -1 || prevCol === -1) {
    throw new Error(
      `Prevalence CSV missing columns "${WORD_COLUMN}"/"${PREVALENCE_COLUMN}". Found: ${header.join(", ")}`,
    );
  }

  for (let i = 1; i < lines.length; i++) {
    const row = splitCsvRow(lines[i]!);
    const word = row[wordCol]?.trim();
    const score = Number(row[prevCol]);
    if (!word || Number.isNaN(score)) continue;
    out.set(normaliseWord(word), score);
  }
  return out;
}

/** Minimal CSV row splitter: handles double-quoted fields with commas. */
function splitCsvRow(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      fields.push(field);
      field = "";
    } else field += ch;
  }
  fields.push(field);
  return fields;
}
