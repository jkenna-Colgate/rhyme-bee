/**
 * Pure parser for the Editor's Pass commands — the one piece of the pass worth
 * testing, so it lives apart from the imperative shell that prints and writes.
 *
 *   npm run editor:read                          # tomorrow's Daily Puzzle
 *   npm run editor:read -- --date=2026-08-20     # a named day
 *   npm run editor:read -- --seed=placeholder    # audition an unscheduled Seed
 *   npm run editor:add -- --words=placeholder,toothache
 *   npm run editor:add -- --words=earache --rhymeKey="EY K"
 *
 * Flags take either spelling, `--date 2026-08-20` or `--date=2026-08-20`. The
 * equals form exists for Windows PowerShell, which strips the bare `--`
 * separator *and* the token after it before npm forwards anything, so the space
 * form loses its flag on the way through. A bare positional token is accepted
 * too — an ISO date reads that day, anything else auditions that Seed Word —
 * which is the short thing to type when invoking `tsx` directly.
 *
 * Throws on any invalid input; the script turns the throw into a clean exit.
 */

/** ISO `YYYY-MM-DD`, the spelling the schedule artifact uses. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type EditorCommand = "read" | "add";

export interface EditorArgs {
  command: EditorCommand;
  /** The day to read, or whose Rhyme Key to add against. Absent means tomorrow. */
  date?: string;
  /** `read` only: a Seed Word to audition instead of reading a scheduled day. */
  seed?: string;
  /** `add` only: the words the editor named. A night's findings are one command. */
  words?: string[];
  /** `add` only: the target Rhyme Key, when not taken from a day. */
  rhymeKey?: string;
}

const COMMANDS: EditorCommand[] = ["read", "add"];

export function parseEditorArgs(argv: string[]): EditorArgs {
  const [first, ...rest] = argv;
  if (first === undefined || !(COMMANDS as string[]).includes(first)) {
    throw new Error(`Expected a command (${COMMANDS.join(", ")}), got: ${first ?? "nothing"}`);
  }
  const args: EditorArgs = { command: first as EditorCommand };

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    const eq = token.indexOf("=");
    // Equals form carries the value in the same token; the space form takes the
    // next one. `inline` distinguishes them so an empty `--date=` still errors.
    const flag = eq === -1 ? token : token.slice(0, eq);
    const inline = eq === -1 ? undefined : token.slice(eq + 1);

    if (flag === "--date") {
      args.date = requireDate(inline ?? rest[++i]);
    } else if (flag === "--seed") {
      args.seed = requireSeed(inline ?? rest[++i]);
    } else if (flag === "--words") {
      args.words = requireWords(inline ?? rest[++i]);
    } else if (flag === "--rhymeKey") {
      args.rhymeKey = requireRhymeKey(inline ?? rest[++i]);
    } else if (flag.startsWith("--")) {
      throw new Error(`Unknown argument: ${token}`);
    } else if (ISO_DATE.test(token)) {
      args.date = requireDate(token);
    } else if (args.command === "add") {
      // Bare words are the thing `add` is for, so they need no flag when the
      // shell lets them through.
      args.words = [...(args.words ?? []), ...requireWords(token)];
    } else {
      args.seed = requireSeed(token);
    }
  }

  // Reading a scheduled day and auditioning an unscheduled Seed are different
  // questions with different readouts, and there is no sensible way to answer
  // both at once — a Seed Word does not have a date.
  if (args.date !== undefined && args.seed !== undefined) {
    throw new Error("Pass a date or a Seed Word, not both: a Seed audition has no date.");
  }
  if (args.command === "add") {
    if (args.words === undefined) {
      throw new Error("Name at least one word, e.g. --words=placeholder,toothache");
    }
    // A day *is* a Rhyme Key here, resolved from the schedule. Two ways of
    // naming the same target can only disagree.
    if (args.date !== undefined && args.rhymeKey !== undefined) {
      throw new Error("Pass a date or a Rhyme Key, not both: the date resolves to a key.");
    }
  } else if (args.words !== undefined || args.rhymeKey !== undefined) {
    throw new Error("--words and --rhymeKey belong to `add`, not `read`.");
  }
  return args;
}

function requireDate(value: string | undefined): string {
  if (value === undefined || !ISO_DATE.test(value)) {
    throw new Error(`--date needs an ISO date, e.g. --date=2026-08-20 (got: ${value ?? "nothing"})`);
  }
  return value;
}

function requireSeed(value: string | undefined): string {
  if (value === undefined || value === "") {
    throw new Error("--seed needs a word, e.g. --seed=placeholder");
  }
  return value;
}

/** One or more words, comma-separated: a night's findings are one command. */
function requireWords(value: string | undefined): string[] {
  const words = (value ?? "")
    .split(",")
    .map((word) => word.trim())
    .filter((word) => word !== "");
  if (words.length === 0) {
    throw new Error("--words needs at least one word, e.g. --words=placeholder,toothache");
  }
  return words;
}

/**
 * A Rhyme Key as the readout prints it — ARPAbet phonemes without stress
 * digits, space-separated. The editor copies it rather than composing it, which
 * is exactly why the readout prints it (story 5).
 */
function requireRhymeKey(value: string | undefined): string {
  const key = value?.trim().toUpperCase();
  if (key === undefined || !/^[A-Z]+( [A-Z]+)*$/.test(key)) {
    throw new Error(`--rhymeKey needs a Rhyme Key, e.g. --rhymeKey="OW L D ER" (got: ${value ?? "nothing"})`);
  }
  return key;
}

/**
 * The day the pass defaults to. The editor runs it the night before, so nothing
 * they find is ever urgent — which only works if "tomorrow" is what they get
 * for typing nothing.
 *
 * Tomorrow is computed from the *local* calendar date, the same date the player
 * will be asking for (ADR-0013), rather than from UTC.
 */
export function tomorrow(today: string): string {
  const [year, month, day] = today.split("-").map(Number) as [number, number, number];
  const date = new Date(year, month - 1, day + 1);
  const iso = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${iso(date.getFullYear(), 4)}-${iso(date.getMonth() + 1)}-${iso(date.getDate())}`;
}
