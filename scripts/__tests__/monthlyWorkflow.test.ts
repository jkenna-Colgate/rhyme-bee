/**
 * The monthly workflow (#274, ADR-0021 amended 2026-10-26), read as text.
 *
 * GitHub runs it and nothing here can. These tests hold what an edit could
 * quietly undo: the steps' order, the one step allowed to fail, the alarm
 * that marks such a run failed, and the keepalive pointing at this file.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../../.github/workflows/monthly.yml", import.meta.url), "utf8");

/** The step block (from its `- name:` line to the next one) that runs `command`. */
function stepRunning(command: string): string {
  const step = workflow.split(/^(?=\s*- name:)/m).find((block) => block.includes(command) && /^\s*run:/m.test(block));
  if (step === undefined) throw new Error(`No step runs \`${command}\`.`);
  return step;
}

describe("the monthly workflow", () => {
  it("runs on a timer of once a month, and by hand", () => {
    expect(workflow).toMatch(/cron: "\d+ \d+ 1 \* \*"/);
    expect(workflow).toMatch(/^\s*workflow_dispatch:/m);
  });

  it("judges the Appeals, makes the Tier moves, rebuilds, reports, commits and keeps itself alive, in that order", () => {
    const order = [
      "npm run appeals:pull",
      "npm run appeals:judge -- --limit",
      "npm run records:pull",
      "npm run -s tier:moves",
      "npm run build:index | tee data/monthly-run/build.log",
      "npm run -s monthly:report",
      "git commit",
      "git push",
      "actions/workflows/monthly.yml/enable",
    ];
    const jobs = workflow.slice(workflow.indexOf("\njobs:"));
    const positions = order.map((command) => jobs.indexOf(command));

    expect(positions).not.toContain(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("lets the Appeals step fail, and no other", () => {
    expect(workflow.match(/continue-on-error/g)).toHaveLength(1);
    expect(stepRunning("npm run appeals:judge")).toMatch(/^\s*continue-on-error: true\s*$/m);
  });

  it("fails the Appeals step when there is no Claude token, even with nothing to judge", () => {
    expect(stepRunning("npm run appeals:judge")).toMatch(/if \[ -z "\$CLAUDE_CODE_OAUTH_TOKEN" \]; then[\s\S]*exit 1/);
  });

  it("deploys through the deploy workflow once the loop has committed", () => {
    expect(workflow).toMatch(/^ {2}deploy:\n {4}needs: loop\n[\s\S]*?uses: \.\/\.github\/workflows\/deploy\.yml\n {4}secrets: inherit$/m);
  });

  it("marks the run failed after the deploy when the Appeals step failed", () => {
    expect(workflow).toMatch(
      /^ {2}alarm:\n {4}needs: \[loop, deploy\]\n {4}if: always\(\) && needs\.loop\.outputs\.appeals == 'failure'\n[\s\S]*exit 1/m,
    );
    expect(workflow).toMatch(/appeals: \$\{\{ steps\.appeals\.outcome \}\}/);
  });

  it("uploads no artifact, so the private sources never leave the runner", () => {
    expect(workflow).not.toMatch(/upload-artifact/);
  });
});
