/**
 * A badge that reaches a message thread with nothing on it (#196, #202).
 *
 * The badge's art is judged by looking at it, and this does not look at it: no
 * pixel here is anybody's business. What is asserted is the one way the badge
 * can be wrong that nobody would see in time — a Rank whose name sets no ink at
 * all, which writes a seal with an empty middle, passes every check the build
 * makes and surfaces weeks later in somebody's chat. The renderer refuses, and
 * the refusal is what makes "a Rank without a badge fails the build" true.
 *
 * The card's dimensions are pinned for the same reason: 1200×630 is what a link
 * preview crops to, and getting it wrong is invisible until a recipient sees a
 * badge with its seal cut off.
 */

import { describe, expect, it } from "vitest";
import { renderBadge } from "../badgeRenderer.ts";

/** Width and height as a PNG header states them, big-endian after the IHDR. */
function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe("renderBadge", () => {
  it("returns a PNG at the size a link card crops to", () => {
    const png = renderBadge("Shakespeare");

    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(pngSize(png)).toEqual({ width: 1200, height: 630 });
  });

  it("sets a Rank of two words as well as one", () => {
    expect(pngSize(renderBadge("Silver Tongue"))).toEqual({
      width: 1200,
      height: 630,
    });
  });

  it("refuses a Rank that would leave the seal empty", () => {
    expect(() => renderBadge("")).toThrow(/empty seal/);
    expect(() => renderBadge("   ")).toThrow(/empty seal/);
  });

  it("still sets a Rank the face has no glyphs for, rather than refusing", () => {
    // Tofu is a badge somebody can look at and fix; an empty seal is not, and
    // only the second is worth failing a build over.
    expect(pngSize(renderBadge("段"))).toEqual({ width: 1200, height: 630 });
  });
});
