/**
 * The monthly workflow's run report (#274): the date, the Appeals judged, the
 * rulings written, the model, the Tier moves and their report lines, and the
 * Continuity lines, in one report in `data/judge-runs/` (#250's format).
 *
 *   npm run -s monthly:report -- [--appeals-step <outcome>]
 *
 * It reads what the earlier steps left in `data/monthly-run/`:
 *
 *   appeals.json     written by `npm run appeals:judge`
 *   tier-moves.log   the output of `npm run -s tier:moves`
 *   build.log        the output of `npm run build:index`, run after the writes
 *
 * and empties that directory, so a part left by one run never reaches the next
 * one's report. `--appeals-step` is the Appeals step's outcome as GitHub gives
 * it; by hand it is `success` when `appeals.json` is there and `skipped` when
 * it is not. It writes the commit subject to `data/monthly-run/commit-message.txt`
 * and prints the report's path. It calls no model and writes nothing to the game.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { JUDGE_MODEL } from "./judgeRun.ts";
import { nextRun, root, today, writeRunReport } from "./modelCall.ts";
import { MONTHLY_RUN_DIR, MONTHLY_STEM, monthlyReport, type AppealsPart } from "./monthlyRun.ts";

const dir = resolve(root, MONTHLY_RUN_DIR);
const part = (name: string) => resolve(dir, name);
const readIfPresent = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");

const appealsText = readIfPresent(part("appeals.json"));
const appeals = appealsText ? (JSON.parse(appealsText) as AppealsPart) : null;
const at = process.argv.indexOf("--appeals-step");
const appealsStep = at !== -1 && process.argv[at + 1] ? process.argv[at + 1]! : appeals ? "success" : "skipped";

const model = JUDGE_MODEL;
const stem = MONTHLY_STEM(model);
const run = appeals?.run ?? nextRun(stem);
const date = appeals?.date ?? today();
const { report, subject } = monthlyReport({
  date,
  run,
  model,
  appealsStep,
  appeals,
  tierMovesLog: readIfPresent(part("tier-moves.log")),
  buildLog: readIfPresent(part("build.log")),
});

const path = writeRunReport(date, stem, run, report);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
writeFileSync(part("commit-message.txt"), `${subject}\n\nThe run report is ${relative(root, path).replace(/\\/g, "/")} (#274).\n`);
console.log(subject);
console.log(`report: ${path}`);
