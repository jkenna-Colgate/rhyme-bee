/**
 * The deploy contains only runtime assets (#121).
 *
 * This is a criterion that regresses silently: nothing breaks when a diagnostic
 * gets published, the site still works, and the only symptom is a repo internal
 * sitting at a public URL until someone thinks to look. So the list of what
 * `dist-data` may contribute to a deploy is pinned here rather than left to be
 * noticed.
 */

import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MANIFEST_FILENAME, writeIndexArtifact } from "../../scripts/indexArtifact.ts";
import { publishedIndexFiles } from "../indexAssetPlugin.ts";

const ARTIFACT_PATTERN = /^index-[0-9a-f]+\.json$/;

/** A `dist-data` with an index built into it, and whatever else is lying about. */
function distDataLike(alsoContaining: string[]): string {
  const dir = mkdtempSync(resolve(tmpdir(), "rhyme-bee-dist-data-"));
  for (const name of alsoContaining) writeFileSync(resolve(dir, name), "irrelevant");
  writeIndexArtifact(dir, '{"index":true}');
  return dir;
}

describe("what dist-data contributes to a deploy", () => {
  it("publishes the current artifact and the manifest that names it", () => {
    const published = publishedIndexFiles(distDataLike([]));

    expect(published).toContain(MANIFEST_FILENAME);
    expect(published.filter((name) => ARTIFACT_PATTERN.test(name))).toHaveLength(1);
    expect(published).toHaveLength(2);
  });

  it("publishes nothing else, however much else is lying about", () => {
    const diagnostics = [
      "dropped-report.json",
      "derived-report.json",
      "probe-85-impact.ts",
      "measure-ablation.ts",
      "suspects.txt",
      "spec-97.md",
      // The probe script nobody has written yet is the case this guards: an
      // allow-list keeps it out without anyone having to remember it.
      "probe-tomorrow.ts",
    ];
    const published = publishedIndexFiles(distDataLike(diagnostics));

    for (const name of diagnostics) expect(published).not.toContain(name);
  });

  it("sweeps the pre-#117 index.json rather than leaving it to be believed", () => {
    const dir = distDataLike(["index.json"]);

    expect(publishedIndexFiles(dir)).not.toContain("index.json");
    // Gone from the directory too. A stale copy of a whole different judge is
    // worth removing wherever it sits, not merely worth declining to upload.
    expect(existsSync(resolve(dir, "index.json"))).toBe(false);
  });

  it("has nothing to publish before an index is built", () => {
    const empty = mkdtempSync(resolve(tmpdir(), "rhyme-bee-dist-data-"));

    expect(publishedIndexFiles(empty)).toEqual([]);
  });
});
