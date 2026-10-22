import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { undeclaredAmendments } from "../adrStatus.js";

const adr = (status: string | null, ...headings: string[]) =>
  [
    "# A decision",
    "",
    ...(status === null ? [] : [status, ""]),
    "The decision as first written.",
    "",
    ...headings.flatMap((h) => [h, "", "What changed."]),
  ].join("\n");

describe("undeclaredAmendments", () => {
  it("passes an ADR whose Status line names every amendment date", () => {
    const text = adr(
      "**Status:** amended 2026-07-29 and 2026-10-07. The rule now holds both ways.",
      "## Amendment (2026-07-29)",
      "## Amendment (2026-10-07): the test holds in either order",
    );
    expect(undeclaredAmendments(text)).toEqual([]);
  });

  it("names an amendment date the Status line leaves out", () => {
    const text = adr(
      "**Status:** amended 2026-07-29. The rule holds one way.",
      "## Amendment (2026-07-29)",
      "## Amendment (2026-10-07)",
    );
    expect(undeclaredAmendments(text)).toEqual(["2026-10-07"]);
  });

  it("names every amendment date when the ADR has no Status line", () => {
    const text = adr(null, "## Amendment (2026-07-29)");
    expect(undeclaredAmendments(text)).toEqual(["2026-07-29"]);
  });

  it("does not take a date mentioned further down for the Status line", () => {
    const text = [
      "# A decision",
      "",
      "Decided on 2026-07-29.",
      "",
      "## Amendment (2026-07-29)",
    ].join("\n");
    expect(undeclaredAmendments(text)).toEqual(["2026-07-29"]);
  });

  it("reads the colon form of the heading", () => {
    const text = adr(null, "## Amendment, 2026-10-07: two rules join the closed set");
    expect(undeclaredAmendments(text)).toEqual(["2026-10-07"]);
  });

  it("reads the dash form of the heading", () => {
    const text = adr(null, "## Amendment, 2026-07-30 — the correction sites are four");
    expect(undeclaredAmendments(text)).toEqual(["2026-07-30"]);
  });

  it("asks nothing of an ADR that was never amended", () => {
    expect(undeclaredAmendments(adr(null))).toEqual([]);
  });
});

describe("the ADRs in docs/adr", () => {
  const dir = fileURLToPath(new URL("../../docs/adr/", import.meta.url));

  it("each name every amendment date in their Status line", () => {
    const undeclared = Object.fromEntries(
      readdirSync(dir)
        .filter((name) => name.endsWith(".md"))
        .map((name) => [name, undeclaredAmendments(readFileSync(dir + name, "utf8"))] as const)
        .filter(([, dates]) => dates.length > 0),
    );
    expect(undeclared).toEqual({});
  });
});
