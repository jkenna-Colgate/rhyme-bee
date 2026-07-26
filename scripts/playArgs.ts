/**
 * Pure parser for the `npm run play` REPL flags — the one piece of the play
 * script worth testing, so it lives apart from the imperative shell.
 *
 * Accepts two spellings of each flag:
 *
 *   --day 6      --seed books      # space-separated
 *   --day=6      --seed=books      # equals form
 *
 * The equals form exists for Windows PowerShell, which strips the bare `--`
 * separator *and* the token after it before npm forwards anything, so
 * `npm run play -- --day 6` reaches the script as just `["6"]`. `--day=6`
 * survives because there is no separated token to swallow.
 *
 * Throws on any invalid input; `play.ts` turns the throw into a clean exit.
 */

export const DAYS = 7;

export interface PlayArgs {
  seed?: string;
  day?: number;
}

export function parsePlayArgs(argv: string[]): PlayArgs {
  const args: PlayArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    const eq = token.indexOf("=");
    // Equals form carries the value in the same token; the space form takes the
    // next one. `inline` distinguishes them so an empty `--seed=` still errors.
    const flag = eq === -1 ? token : token.slice(0, eq);
    const inline = eq === -1 ? undefined : token.slice(eq + 1);

    if (flag === "--seed") {
      const value = inline ?? argv[++i];
      if (value === undefined || value === "") {
        throw new Error("--seed needs a word, e.g. --seed=book");
      }
      args.seed = value;
    } else if (flag === "--day") {
      const value = Number(inline ?? argv[++i]);
      if (!Number.isInteger(value) || value < 1 || value > DAYS) {
        throw new Error(`--day needs an integer 1..${DAYS} (1 easiest, ${DAYS} hardest)`);
      }
      args.day = value;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}
