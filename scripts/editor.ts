/**
 * The Editor's Pass: read a Daily Puzzle the night before it goes live, and add
 * the words that read turns up as missing.
 *
 *   npm run editor:read                          # tomorrow
 *   npm run editor:read -- --date=2026-08-20     # a named day
 *   npm run editor:read -- --seed=placeholder    # audition an unscheduled Seed
 *   npm run editor:add -- --words=placeholder,toothache
 *   npm run editor:add -- --words=earache --rhymeKey="EY K"
 *
 * On Windows PowerShell the bare `--` separator (and the token after it) is
 * stripped before npm forwards anything, so use the equals form above, or
 * invoke tsx directly: `npx tsx scripts/editor.ts read --date 2026-08-20`.
 *
 * The entry point and nothing else: parse the arguments, load the schedule,
 * dispatch. The pass is two activities that share almost nothing, so each has
 * its own module and changes for its own reason —
 *
 *   `editorRead.ts`   resolving a day, the drift check, the columns, the
 *                     schedule/index agreement failure. Writes nothing.
 *   `editorAdd.ts`    composition, the agent shell-out, the supplement append,
 *                     the deferred queue. Never opens the built index.
 *   `editorShell.ts`  what they genuinely share: the root, the exit, the
 *                     schedule artifact.
 *   `editorArgs.ts`   the argument parsing for both, which is tested.
 *   `editorReading.ts` the parse of what the agent says back, also tested.
 */

import { localCalendarDate } from "../src/schedule.ts";
import { add, targetFor } from "./editorAdd.ts";
import { parseEditorArgs, tomorrow, type EditorArgs } from "./editorArgs.ts";
import { audition, readDay } from "./editorRead.ts";
import { fail, loadSchedule, message } from "./editorShell.ts";

let args: EditorArgs;
try {
  args = parseEditorArgs(process.argv.slice(2));
} catch (error) {
  fail(message(error));
}

const schedule = loadSchedule();

if (args.command === "add") {
  const { target, provenance } =
    args.rhymeKey !== undefined
      ? { target: args.rhymeKey, provenance: "an explicit Rhyme Key" }
      : targetFor(schedule, args.date ?? tomorrow(localCalendarDate()));
  await add(args.words!, target, provenance);
} else if (args.seed !== undefined) {
  audition(schedule, args.seed);
} else {
  readDay(schedule, args.date ?? tomorrow(localCalendarDate()));
}
