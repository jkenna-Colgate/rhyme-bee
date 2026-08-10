/**
 * The editor's index cache, over a real artifact in a temp directory.
 *
 * What is worth testing here is not the parse — `src/serialise.ts` owns that
 * and is tested there — but the **holding**: that the copy survives a second
 * ask, that `forget` is what ends it, and that the threshold handed to the Tier
 * picker is the one the artifact on disk was built with rather than whatever
 * constant this process happens to have compiled in.
 *
 * The artifacts are built the way the real one is, by the parts that already
 * compose: `buildTestIndex` manufactures the data, `serialise` turns it into the
 * artifact's own shape, and `writeIndexArtifact` names it by content hash and
 * sweeps what it supersedes. That last step is why the fourth case below is a
 * fact rather than a worry — writing the second artifact *deletes* the first, so
 * a cache that held its copy is holding an index parsed from a file that no
 * longer exists, which is exactly the failure `web/builtIndex.ts` warns about.
 *
 * No build is spawned. `npm run build:index` resolves its own directories from
 * its file location, so a temp root would not reach it; what is under test is
 * the cache, and the cache only ever sees a directory of finished artifacts.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KNOWNNESS_THRESHOLD, buildTestIndex } from "../../src/__fixtures__/index.ts";
import { serialise } from "../../src/serialise.ts";
import { writeIndexArtifact } from "../../scripts/indexArtifact.ts";
import { makeIndexCache } from "../builtIndex.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rhyme-bee-built-index-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Build an artifact into the temp `dist-data` and return its absolute path.
 * The Answer/Bonus threshold is the only thing that varies between the two
 * artifacts these tests use, which makes the flip from one to the other
 * directly readable off `knownnessThreshold()`.
 */
function writeArtifact(knownnessThreshold: number): string {
  const { data } = buildTestIndex({ knownnessThreshold });
  const contents = JSON.stringify(
    serialise(data, { knownnessThreshold }, { cmudict: "fixture" }),
  );
  return join(dir, writeIndexArtifact(dir, contents).index);
}

describe("makeIndexCache", () => {
  it("parses the artifact once and answers the second ask from the copy", () => {
    writeArtifact(0);
    const cache = makeIndexCache(dir);
    const first = cache.index();

    // A whole new artifact lands, and nothing tells the cache. The second ask
    // has to come back with the copy — the same object, and the old threshold —
    // or the "loaded once" the fifteen megabytes are justified by is not true.
    writeArtifact(1);

    expect(cache.index()).toBe(first);
    expect(cache.knownnessThreshold()).toBe(0);
  });

  it("reads the new artifact on the ask after forget", () => {
    writeArtifact(0);
    const cache = makeIndexCache(dir);
    const stale = cache.index();
    expect(cache.knownnessThreshold()).toBe(0);

    writeArtifact(1);
    cache.forget();

    expect(cache.index()).not.toBe(stale);
    expect(cache.knownnessThreshold()).toBe(1);
  });

  it("reports the artifact's own Answer/Bonus threshold, not the environment's", () => {
    writeArtifact(0);

    // The fixture builds at `KNOWNNESS_THRESHOLD` by default, and this artifact
    // was built at something else. A cache that restated the constant instead of
    // reading the config would agree with the environment and be wrong about the
    // index actually on screen.
    expect(makeIndexCache(dir).knownnessThreshold()).toBe(0);
    expect(makeIndexCache(dir).knownnessThreshold()).not.toBe(KNOWNNESS_THRESHOLD);
  });

  it("holds an index parsed from a file the next build has already swept away", () => {
    const superseded = writeArtifact(0);
    const cache = makeIndexCache(dir);
    const held = cache.index();

    const current = writeArtifact(1);

    // Content-addressed and swept: the second write is a different filename and
    // takes the first one with it. So the copy the cache is still handing out is
    // not merely out of date, it is an index no file on disk contains.
    expect(current).not.toBe(superseded);
    expect(existsSync(superseded)).toBe(false);
    expect(cache.index()).toBe(held);

    // And forgetting is what resolves it, because the path is resolved through
    // the manifest on every load rather than captured when the cache was made.
    cache.forget();
    expect(cache.knownnessThreshold()).toBe(1);
  });
});
