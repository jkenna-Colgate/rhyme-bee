/**
 * The one escape both build-time renderers use (#196).
 *
 * A Rank label is set into two generated documents — the badge's SVG and the
 * landing page's HTML — and both are angle-bracket markup with
 * double-quoted attributes, so both need the same four substitutions. They had
 * a copy each, which is one copy too many for a rule where a miss is not a
 * rendering bug but a broken document: an unescaped `&` in a label makes the
 * SVG unparseable and the rasteriser throws, and an unescaped `"` in the page's
 * `og:title` ends the attribute early and truncates the claim the card makes.
 *
 * Ranks are named by hand and none of them contains any of these characters
 * today. That is exactly why the rule has to live in one place: nothing about
 * the shipped ladder would notice if one copy drifted.
 */

/**
 * Escape `text` for use as element content or inside a double-quoted attribute.
 *
 * The apostrophe is deliberately left alone: it is legal in both positions here
 * because every attribute these renderers write is double-quoted, and escaping
 * it would make a possessive Rank name unreadable in the source.
 */
export function escapeMarkup(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
