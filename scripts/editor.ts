/**
 * The Editor's Pass: read a Daily Puzzle the night before it goes live, and add
 * the words that read turns up as missing.
 *
 *   npm run editor:read                                     # tomorrow
 *   npx tsx scripts/editor.ts read --date 2026-08-20        # a named day
 *   npx tsx scripts/editor.ts read --seed thunder           # audition an unscheduled Seed
 *   npx tsx scripts/editor.ts add --words "placeholder,toothache"
 *   npx tsx scripts/editor.ts add --words earache --rhymeKey "EY K"
 *
 * **Do not reach these through `npm run` on Windows PowerShell.** PowerShell
 * eats the bare `--` separator itself, so it never reaches npm; npm then reads
 * the flags that follow as its own configuration and forwards them nowhere. The
 * equals form is not the fix — it fails the same way. What survives depends on
 * the flag name and is not worth learning: `--date=…` vanishes outright, while
 * `--day=6` leaks a bare `6` through. Either quote the separator
 * (`npm run editor:read '--' '--date=2026-08-20'`), or invoke tsx as above,
 * which has no separator to lose. See `editorArgs.ts` for why the mangled form
 * can still appear to work.
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
import type { AddTarget } from "../web/src/editor/addOutcome.ts";
import { add, printAddOutcome, targetFor } from "./editorAdd.ts";
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
  const aim: AddTarget =
    args.rhymeKey !== undefined
      ? { target: args.rhymeKey, provenance: "an explicit Rhyme Key" }
      : targetFor(schedule, args.date ?? tomorrow(localCalendarDate()));
  printAddOutcome(await add(args.words!, aim));
} else if (args.seed !== undefined) {
  audition(schedule, args.seed);
} else {
  readDay(schedule, args.date ?? tomorrow(localCalendarDate()));
}
