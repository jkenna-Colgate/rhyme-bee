/**
 * What the two halves of the Editor's Pass genuinely share: where the repo is,
 * how the command dies, and the schedule artifact both of them resolve a day
 * against. Deliberately small — reading a Daily Puzzle and adding a word by
 * name have almost nothing else in common, which is why they are separate
 * modules, and anything that drifts in here should be checked against that.
 *
 * Untested with the rest of the shell: `parseSchedule` is the tested part of
 * `loadSchedule`, and the rest is a path and a process exit.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSchedule, type Schedule } from "../src/schedule.ts";

/** The repo root, so every path in the pass is written from one place. */
export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function fail(text: string): never {
  console.error(text);
  process.exit(1);
}

/** What a thrown thing has to say for itself, whether or not it is an Error. */
export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function loadSchedule(): Schedule {
  const path = resolve(root, "data/schedule.json");
  const parsed = parseSchedule(JSON.parse(readFileSync(path, "utf8")));
  if (parsed === null) fail(`${path} is not a readable schedule artifact.`);
  return parsed;
}
