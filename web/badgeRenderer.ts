/**
 * The Rank badge: label in, PNG bytes out (#196, #202).
 *
 * A shared Rank travels as a link card, and a link card is a picture. The badge
 * is that picture — 1200×630, the Rank name set inside a neutral seal, and
 * nothing else. No wordmark, no date, no Score, and specifically nothing shaped
 * like a meter: a gauge or a partly filled ring would re-encode the percentage
 * the badge exists to withhold, so the art in `badge/template.svg` has none and
 * this module adds none.
 *
 * Everything about *how* the picture is made lives behind `renderBadge` — the
 * template, the embedded face, the fitting of the label and the rasterisation.
 * Replacing the art later is an edit inside here and in the template, with the
 * interface unchanged. There is no renderer abstraction over that, because
 * there is one implementation and a seam there would be hypothetical.
 *
 * ## Build time only
 *
 * Nothing here is reachable from the browser bundle or the Worker: it is
 * imported by `shareAssetPlugin`, which the Vite config runs during a build.
 * The rasteriser is a native dependency and the display face is a font file,
 * and neither is shipped — the site declares system font stacks, so there is no
 * interface typography for the badge to match and it is free to be an award
 * rather than an extension of the interface.
 *
 * ## What the tests here can and cannot settle
 *
 * The badge's pixels are judged by looking at them: no assertion distinguishes
 * a well-set seal from a blank square, so none is attempted. What
 * `__tests__/badgeRenderer.test.ts` covers is the frame around the art — that
 * bytes come back as a PNG at the size a link card crops to, that a two-word
 * Rank and a Rank the face has no glyphs for both still render, and that a
 * label leaving the seal empty throws rather than shipping. Those are the
 * failures that would otherwise reach a message thread unseen; the art itself
 * is reviewed by opening it.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { escapeMarkup } from "./escapeMarkup.ts";

const badgeDir = resolve(dirname(fileURLToPath(import.meta.url)), "badge");

/** The seal, and the two tokens the label is substituted into. */
const TEMPLATE_FILE = resolve(badgeDir, "template.svg");

/**
 * The one embedded face: Cinzel, SIL Open Font License (see `badge/font`).
 *
 * An inscriptional Roman capital, which is what a seal wants. It is vendored
 * rather than fetched so a build is not one network hiccup away from a badge
 * set typeset in whatever the machine happened to have installed.
 */
const FONT_FILE = resolve(badgeDir, "font", "Cinzel-Variable.ttf");
const FONT_FAMILY = "Cinzel";

/** How much of the seal the label may occupy, in user units. */
const TEXT_WIDTH = 440;
const TEXT_HEIGHT = 250;

/** Big enough to fill the seal, and no bigger — a short label is not a poster. */
const MAX_FONT_SIZE = 104;

/** The nominal size the label is measured at, then scaled from. Round, and
 * otherwise arbitrary: nothing is rendered at it. */
const NOMINAL_FONT_SIZE = 100;

/** Line spacing, as a multiple of the font size. */
const LINE_HEIGHT = 1.15;

const template = readFileSync(TEMPLATE_FILE, "utf8");

/**
 * The template's own `<text>` opening tag, and the x it centres on.
 *
 * The fitting pass sets the label a second time, off to one side, to measure it.
 * It reuses this tag rather than restating the family, the weight and the
 * letter-spacing, because a measurement made under different typography than
 * the badge is drawn with is not a measurement: editing `letter-spacing` in the
 * art would otherwise silently invalidate every fit, and the label would creep
 * over the ring with the build none the wiser.
 */
function templateTextTag(): string {
  const tag = /<text\s[^>]*>/.exec(template)?.[0];
  if (tag === undefined) {
    throw new Error(
      `No <text> element in ${TEMPLATE_FILE}. The badge template must carry ` +
        "one, with the {{FONT_SIZE}} and {{RANK}} tokens, or no Rank can be " +
        "set in it.",
    );
  }
  return tag;
}

const textTag = templateTextTag();
const textX = /\sx="([^"]*)"/.exec(textTag)?.[1] ?? "0";

/**
 * Rasteriser options that make the embedded face the only face there is.
 *
 * The file is named rather than handed over as a buffer: `fontBuffers` does not
 * match this face by family name and silently falls through to whatever the
 * machine has installed, which would typeset the badge differently on every
 * developer's laptop. System fonts are off for the same reason — a build that
 * cannot find Cinzel should look wrong here, not quietly ship wrong.
 */
const fontOptions = {
  fontFiles: [FONT_FILE],
  loadSystemFonts: false,
  defaultFontFamily: FONT_FAMILY,
};

/**
 * The ways a label can be broken across lines, for the caller to choose between
 * by which one fits largest.
 *
 * One line always, and — for a label of two or more words — the balanced split
 * that leaves the longest line as short as it can be. `Silver Tongue` set on
 * one line is a thin ribbon across a wide seal; stacked, it fills it.
 */
function layouts(label: string): string[][] {
  const words = label.split(/\s+/).filter((word) => word.length > 0);
  const oneLine = [label];
  if (words.length < 2) return [oneLine];

  const longest = (at: number) =>
    Math.max(
      words.slice(0, at).join(" ").length,
      words.slice(at).join(" ").length,
    );
  let best = 1;
  for (let at = 2; at < words.length; at++) {
    if (longest(at) < longest(best)) best = at;
  }

  return [
    oneLine,
    [words.slice(0, best).join(" "), words.slice(best).join(" ")],
  ];
}

/** The label as `<tspan>` lines, centred on the template's text anchor. */
function tspans(lines: string[], fontSize: number): string {
  const first = -((lines.length - 1) / 2) * LINE_HEIGHT * fontSize;
  return lines
    .map((line, index) => {
      const dy = index === 0 ? first + fontSize * 0.34 : LINE_HEIGHT * fontSize;
      return `<tspan x="${textX}" dy="${dy.toFixed(2)}">${escapeMarkup(line)}</tspan>`;
    })
    .join("");
}

function badgeSvg(lines: string[], fontSize: number): string {
  return template
    .replaceAll("{{FONT_SIZE}}", String(fontSize))
    .replaceAll("{{RANK}}", tspans(lines, fontSize));
}

/**
 * The largest size at which these lines still fit the seal.
 *
 * Measured rather than estimated: the label is rendered once at a nominal size
 * and the rasteriser is asked for the ink's bounding box, so the fit holds for
 * whatever face the template asks for and whatever letters a Rank is named in.
 */
function fittedSize(label: string, lines: string[]): number {
  const measured = new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="2000">` +
      textTag.replace("{{FONT_SIZE}}", String(NOMINAL_FONT_SIZE)) +
      tspans(lines, NOMINAL_FONT_SIZE) +
      `</text></svg>`,
    { font: fontOptions },
  ).getBBox();

  // No box means the label left no ink — an empty or blank Rank name, since a
  // name in a script the face has no glyphs for still sets tofu and measures.
  // That would write a badge with an empty seal on it, which is the failure
  // this whole ticket exists to keep out of somebody's message thread, so it
  // stops the build here instead of passing.
  if (measured === undefined) {
    throw new Error(
      `The Rank ${JSON.stringify(label)} set no visible label, so its badge ` +
        "would be an empty seal. A Rank a player can reach must be shareable.",
    );
  }

  const scale = Math.min(
    TEXT_WIDTH / measured.width,
    TEXT_HEIGHT / measured.height,
  );
  return Math.min(MAX_FONT_SIZE, Math.floor(NOMINAL_FONT_SIZE * scale));
}

/**
 * One badge, as PNG bytes. The only thing that varies across the ladder is the
 * label: there is deliberately no ramp, because the game's visual identity is
 * not settled and an un-ramped template commits to nothing.
 */
export function renderBadge(label: string): Buffer {
  let chosen: string[] = [label];
  let size = 0;
  for (const lines of layouts(label)) {
    const fit = fittedSize(label, lines);
    if (fit > size) {
      size = fit;
      chosen = lines;
    }
  }

  return new Resvg(badgeSvg(chosen, size), {
    font: fontOptions,
    fitTo: { mode: "original" },
  })
    .render()
    .asPng();
}
