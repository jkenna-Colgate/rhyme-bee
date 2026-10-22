/**
 * An amended ADR states what is true now in a Status line under its title
 * (#247), because amendments are appended at the bottom and the opening an
 * agent reads first can contradict them.
 */

const AMENDMENT_HEADING = /^#{2,}\s+Amendment\b.*?(\d{4}-\d{2}-\d{2})/;

/** The Status line: the first non-blank line after the title, if it is one. */
function statusLine(lines: string[]): string {
  const title = lines.findIndex((line) => line.startsWith("# "));
  const next = lines.slice(title + 1).find((line) => line.trim() !== "");
  return next?.startsWith("**Status:**") ? next : "";
}

/**
 * The dates of the ADR's amendment headings that its Status line does not
 * name, in the order the amendments appear. Empty when the ADR is in order.
 */
export function undeclaredAmendments(adr: string): string[] {
  const lines = adr.split(/\r?\n/);
  const status = statusLine(lines);
  return lines
    .map((line) => AMENDMENT_HEADING.exec(line)?.[1])
    .filter((date): date is string => date !== undefined)
    .filter((date) => !status.includes(date));
}
