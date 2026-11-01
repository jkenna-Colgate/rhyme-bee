// Fails on purpose: step 9 of #282 checks that a failing test stops the deploy.
// Reverted by the next commit.
import { expect, it } from "vitest";

it("stops the deploy (step 9 of #282)", () => {
  expect("deploy").toBe("stopped");
});
