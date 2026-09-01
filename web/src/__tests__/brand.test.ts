/**
 * The wordmark, and the two literals that cannot import it.
 *
 * `GAME_NAME` is the source of truth for every surface that names the game to a
 * player (#199), and the React ones read it. `index.html` and `editor.html`
 * cannot — they are static documents Vite serves before any module runs — so
 * they repeat the string, and this file is what stops the repetition drifting.
 * A build plugin injecting one word into two files would be more machinery than
 * the drift it prevents; a test that reads the two titles is not.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GAME_NAME } from "../brand.ts";

function title(page: string): string {
  const html = readFileSync(new URL(`../../${page}`, import.meta.url), "utf8");
  const match = /<title>([^<]*)<\/title>/.exec(html);
  const found = match?.[1];
  if (found === undefined) throw new Error(`${page} has no <title>`);
  return found;
}

describe("the wordmark", () => {
  it("is the gerund compound, like every other -bee", () => {
    expect(GAME_NAME).toBe("Rhyming Bee");
  });

  it("is the player's tab title", () => {
    expect(title("index.html")).toBe(GAME_NAME);
  });

  it("names the Editor's Pass tab too", () => {
    expect(title("editor.html")).toBe(`Editor's Pass — ${GAME_NAME}`);
  });
});
