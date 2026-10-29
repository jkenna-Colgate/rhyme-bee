/**
 * The deploy workflow (#273, ADR-0013 amended 2026-10-26), read as text.
 *
 * What it promises is GitHub's to keep: a step that fails stops every step
 * after it. These tests hold the three things an edit to the file could
 * quietly undo, each one a line somebody adds while chasing a red build: a
 * check moved after the deploy, a `continue-on-error` on a flaky step, and an
 * artifact upload of `data/` or `dist-data/` for debugging, which would publish
 * the prevalence norms the amendment keeps private.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../../.github/workflows/deploy.yml", import.meta.url),
  "utf8",
);

/** Each `run:` command, in file order. */
const runs = [...workflow.matchAll(/^\s*run:\s*(.+)$/gm)].map((match) => match[1]!.trim());

/** The step block (from its `- name:` line to the next one) whose `run:` is `command`. */
function stepRunning(command: string): string {
  const step = workflow
    .split(/^(?=\s*- name:)/m)
    .find((block) => new RegExp(`^\\s*run:\\s*${command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").test(block));
  if (step === undefined) throw new Error(`No step runs \`${command}\`.`);
  return step;
}

describe("the deploy workflow", () => {
  it("runs every check, in the order the ticket gives, before the deploy", () => {
    const order = [
      "npm run sources:fetch",
      "npm run build:index",
      "npm test",
      "npm run typecheck",
      "npx tsc --noEmit -p web/tsconfig.json",
      "npm run --prefix web build",
      "npm run --prefix web deploy",
    ];
    const positions = order.map((command) => runs.indexOf(command));

    expect(positions).not.toContain(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(runs.at(-1)).toBe("npm run --prefix web deploy");
  });

  it("lets no step fail without stopping the deploy", () => {
    expect(workflow).not.toMatch(/continue-on-error/);
  });

  it("deploys only once the setup check has passed", () => {
    expect(stepRunning("npm run --prefix web deploy")).toMatch(
      /^\s*if:\s*vars\.SETUP_CHECK_PASSED == 'true'\s*$/m,
    );
  });

  it("uploads no artifact, so the private sources never leave the runner", () => {
    expect(workflow).not.toMatch(/upload-artifact/);
  });
});
