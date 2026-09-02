/**
 * The landing page's head, through the renderer's interface (#196, #203).
 *
 * The rendered page is judged by looking at it, so nothing here checks how it
 * is laid out. What is checked is the card's metadata, because that is the part
 * nobody looks at: it is read by a scraper, in somebody else's message thread,
 * and a wrong or relative image URL produces a card with no badge and no way to
 * find out short of sending one.
 *
 * The two negative assertions carry as much weight as the positive ones. A
 * description would change the card's shape from graphic-and-title to a
 * paragraph beside a thumbnail; a Seed Word, a date or a Score on the page would
 * spoil a recipient's own game or go stale behind Apple's preview cache.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_RANK_LADDER } from "../../src/scoring.ts";
import { shareTargets, type ShareTarget } from "../src/share/shareTargets.ts";
import { renderSharePage } from "../sharePageRenderer.ts";

const ORIGIN = "https://example.test";

const TARGETS = shareTargets(DEFAULT_RANK_LADDER, ORIGIN);

/** The `content` of a `<meta>` carrying the given `property` or `name`. */
function metaContent(html: string, key: string): string | null {
  const tag = new RegExp(`<meta[^>]*(?:property|name)="${key}"[^>]*>`).exec(html)?.[0];
  return tag === undefined ? null : (/\scontent="([^"]*)"/.exec(tag)?.[1] ?? null);
}

describe("renderSharePage", () => {
  it("claims the Rank in the Open Graph title, and in the document title too", () => {
    for (const target of TARGETS) {
      const html = renderSharePage(target);
      expect(metaContent(html, "og:title")).toBe(target.title);
      expect(html).toContain(`<title>${target.title}</title>`);
    }
  });

  it("points a scraper at an absolute badge URL rooted at the supplied origin", () => {
    for (const target of TARGETS) {
      const image = metaContent(renderSharePage(target), "og:image");
      expect(image).toBe(target.badgeUrl);
      expect(image).toBe(`${ORIGIN}/${target.badgeFile}`);
    }
  });

  it("declares its own absolute URL as canonical, so a card cannot be attributed elsewhere", () => {
    for (const target of TARGETS) {
      const html = renderSharePage(target);
      expect(metaContent(html, "og:url")).toBe(target.url);
      expect(html).toContain(`<link rel="canonical" href="${target.url}" />`);
    }
  });

  it("carries no description, so the card stays graphic, title and host", () => {
    for (const target of TARGETS) {
      const html = renderSharePage(target);
      expect(metaContent(html, "og:description")).toBeNull();
      expect(metaContent(html, "description")).toBeNull();
    }
  });

  it("shows the badge and offers exactly one way into the game", () => {
    for (const target of TARGETS) {
      const html = renderSharePage(target);
      expect(html).toContain(`src="${target.badgePath}"`);
      expect([...html.matchAll(/<a\s[^>]*href="([^"]*)"/g)].map((m) => m[1])).toEqual(["/"]);
    }
  });

  it("names no date and no Score, so it can neither spoil a day nor go stale", () => {
    const html = renderSharePage(TARGETS[0]!);
    // The Seed Word is deliberately not checked for, and could not be: this
    // module is handed a Rank and never sees a schedule, so there is no word
    // here to look for. What is checkable is that none of the vocabulary of a
    // Session or of a date reached the page, which is what a stray edit adding
    // "you scored 42 today" would trip.
    expect(html).not.toMatch(/\b(score|points?|answers?)\b/i);
    expect(html).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
    expect(html).not.toMatch(/\b(today|yesterday|tomorrow)\b/i);
  });

  it("escapes a label rather than letting it close a tag or an attribute", () => {
    const hostile: ShareTarget = {
      ...TARGETS[0]!,
      label: `Bard & "Co." <script>`,
      title: `I got Bard & "Co." <script> in Rhyming Bee`,
    };
    const html = renderSharePage(hostile);

    expect(html).not.toContain("<script>");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
    expect(metaContent(html, "og:title")).toBe(
      "I got Bard &amp; &quot;Co.&quot; &lt;script&gt; in Rhyming Bee",
    );
  });
});
