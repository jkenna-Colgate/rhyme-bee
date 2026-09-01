/**
 * The share-target projection, through its interface.
 *
 * This is the one seam the share feature turns on, and the only reason it is
 * tested this hard is that its failure mode is silent: a target whose URL points
 * at a file the build never writes survives typecheck, survives the whole suite,
 * and surfaces weeks later as a broken link card in somebody's message thread
 * (#196, #201). So what is held to account here is the *contract between the two
 * sides* — the build maps over these targets to emit files, the browser looks up
 * one to construct a link — rather than any particular string.
 *
 * Totality is asserted against arbitrary ladders, not just the shipped one. The
 * Rank ladder is a knob on `ScoringConfig`, not a constant; the web shell passes
 * no override today, and a test that leaned on that fact would stop being a
 * guard the moment one did.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_RANK_LADDER, type RankTier } from "../../src/scoring.ts";
import { GAME_NAME } from "../src/brand.ts";
import { shareTargets, type ShareTarget } from "../src/share/shareTargets.ts";

const ORIGIN = "https://example.test";

/** Every ladder the projection is required to be total over, not merely the shipped one. */
const AWKWARD_LADDERS: Record<string, RankTier[]> = {
  "the shipped ladder": DEFAULT_RANK_LADDER,
  "an empty ladder": [],
  "a single rung": [{ threshold: 0, label: "Beginner" }],
  "labels that collide once slugged": [
    { threshold: 0, label: "Silver Tongue" },
    { threshold: 50, label: "silver tongue" },
    { threshold: 90, label: "SILVER-TONGUE" },
  ],
  "labels with no URL-safe characters at all": [
    { threshold: 0, label: "" },
    { threshold: 50, label: "!!!" },
    { threshold: 90, label: "   " },
  ],
  "labels carrying punctuation, accents and non-Latin script": [
    { threshold: 0, label: "Poet's Apprentice" },
    { threshold: 30, label: "Trouvère" },
    { threshold: 60, label: "Bard & Co." },
    { threshold: 90, label: "詩人" },
  ],
};

describe("shareTargets", () => {
  it("returns one target per rung, in ladder order", () => {
    const targets = shareTargets(DEFAULT_RANK_LADDER, ORIGIN);

    expect(targets).toHaveLength(DEFAULT_RANK_LADDER.length);
    expect(targets.map((target) => target.label)).toEqual(
      DEFAULT_RANK_LADDER.map((rung) => rung.label),
    );
  });

  it("titles the card with the claim the sharer is making", () => {
    const laureate = shareTargets(DEFAULT_RANK_LADDER, ORIGIN).find(
      (target) => target.label === "Laureate",
    );

    expect(laureate?.title).toBe(`I got Laureate in ${GAME_NAME}`);
    // Spelled out, so the test fails if the wordmark stops being interpolated.
    expect(laureate?.title).toBe("I got Laureate in Rhyming Bee");
  });

  it("slugs the labels readably", () => {
    const slugs = shareTargets(DEFAULT_RANK_LADDER, ORIGIN).map((target) => target.slug);

    expect(slugs).toContain("beginner");
    expect(slugs).toContain("first-verse");
    expect(slugs).toContain("shakespeare");
  });

  it("roots every URL at the supplied origin", () => {
    const [first] = shareTargets(DEFAULT_RANK_LADDER, ORIGIN);

    expect(first?.url).toBe(`${ORIGIN}${first?.pagePath}`);
    expect(first?.badgeUrl).toBe(`${ORIGIN}${first?.badgePath}`);
  });

  it("takes the origin as an argument rather than assuming one", () => {
    const here = shareTargets(DEFAULT_RANK_LADDER, "https://one.test");
    const there = shareTargets(DEFAULT_RANK_LADDER, "https://another.test");

    expect(here[0]?.url).not.toBe(there[0]?.url);
    expect(there[0]?.url.startsWith("https://another.test/")).toBe(true);
  });

  it("tolerates a trailing slash on the origin rather than doubling it", () => {
    const bare = shareTargets(DEFAULT_RANK_LADDER, ORIGIN);
    const slashed = shareTargets(DEFAULT_RANK_LADDER, `${ORIGIN}/`);

    expect(slashed).toEqual(bare);
  });

  it("writes no deployed hostname into the module", () => {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      resolve(moduleDir, "../src/share/shareTargets.ts"),
      "utf8",
    );

    expect(source).not.toMatch(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i);
    // A bare host would be just as baked in as one carrying a scheme.
    expect(source).not.toMatch(/\b[a-z0-9-]+\.(?:dev|com|net|org|app|io|test)\b/i);
  });

  describe.each(Object.entries(AWKWARD_LADDERS))("over %s", (_name, ladder) => {
    const targets = shareTargets(ladder, ORIGIN);

    it("is total: one target per rung, every derived field filled", () => {
      expect(targets).toHaveLength(ladder.length);
      for (const [index, target] of targets.entries()) {
        // `label` is the caller's own string, passed through rather than
        // derived, so an empty one is theirs to have written. Everything else is
        // this module's work and has to be there.
        const derived: (keyof ShareTarget)[] = [
          "slug",
          "title",
          "pageFile",
          "badgeFile",
          "pagePath",
          "badgePath",
          "url",
          "badgeUrl",
        ];
        for (const field of derived) {
          expect(target[field], `${field} of rung ${index}`).not.toBe("");
        }
        expect(target.label).toBe(ladder[index]?.label);
      }
    });

    it("gives every rung a unique, URL-safe slug", () => {
      const slugs = targets.map((target) => target.slug);

      expect(new Set(slugs).size).toBe(slugs.length);
      for (const slug of slugs) {
        expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
        expect(encodeURIComponent(slug)).toBe(slug);
      }
    });

    it("gives every rung exactly one page and exactly one badge, all distinct", () => {
      const pages = targets.map((target) => target.pageFile);
      const badges = targets.map((target) => target.badgeFile);

      expect(new Set(pages).size).toBe(ladder.length);
      expect(new Set(badges).size).toBe(ladder.length);
      expect(pages.filter((page) => badges.includes(page))).toEqual([]);
    });

    it("names the file the build writes and the path the browser asks for identically", () => {
      for (const target of targets) {
        expect(target.pagePath).toBe(`/${target.pageFile}`);
        expect(target.badgePath).toBe(`/${target.badgeFile}`);
        expect(target.url).toBe(`${ORIGIN}/${target.pageFile}`);
        expect(target.badgeUrl).toBe(`${ORIGIN}/${target.badgeFile}`);
      }
    });

    it("keeps the badge and the page of a rung on the same slug", () => {
      for (const target of targets) {
        expect(target.pageFile).toContain(target.slug);
        expect(target.badgeFile).toContain(target.slug);
      }
    });
  });
});
