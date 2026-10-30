/**
 * The source mirror's checksum check (#272): the laptop build and the CI fetch
 * refuse to use a source file whose bytes are not the ones committed.
 *
 * Expected digests are the published SHA-256 test vectors (FIPS 180-2), not
 * values recomputed the way the module computes them.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildRefusal,
  checkLocalSources,
  fetchedFiles,
  fetchSources,
  INDEX_SOURCES,
  SOURCE_FILES,
  WIKTIONARY_SOURCE,
  withChecksum,
} from "../sourceMirror.ts";

/** SHA-256 of the three bytes `abc`. */
const ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
/** SHA-256 of no bytes at all. */
const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A `data/` directory holding the given files. */
function dataDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "source-mirror-"));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

const PINNED =
  `${ABC}  cmudict.dict\n` +
  `${EMPTY}  words.txt\n` +
  `${ABC}  names.txt\n` +
  `${EMPTY}  prevalence.csv\n` +
  `${ABC}  wiktionary.tsv\n`;

describe("the laptop check", () => {
  it("passes four sources that match their committed checksums", () => {
    const dir = dataDir({
      "sources.sha256": PINNED,
      "cmudict.dict": "abc",
      "words.txt": "",
      "names.txt": "abc",
      "prevalence.csv": "",
    });
    expect(checkLocalSources(dir)).toEqual([]);
  });

  it("checks only the index's four sources, so a build needs no Wiktionary extract", () => {
    const dir = dataDir({
      "sources.sha256": PINNED,
      "cmudict.dict": "abc",
      "words.txt": "",
      "names.txt": "abc",
      "prevalence.csv": "",
    });
    expect(checkLocalSources(dir)).toEqual([]);
    expect(checkLocalSources(dir, ["wiktionary.tsv"])).toEqual([{ file: "wiktionary.tsv", problem: "missing" }]);
  });

  it("names a source whose bytes have changed, a missing one, and an unpinned one", () => {
    const dir = dataDir({
      "sources.sha256": `${ABC}  cmudict.dict\n${EMPTY}  words.txt\n${ABC}  names.txt\n`,
      "cmudict.dict": "abd",
      "names.txt": "abc",
      "prevalence.csv": "",
    });
    expect(checkLocalSources(dir)).toEqual([
      { file: "cmudict.dict", problem: "mismatch" },
      { file: "words.txt", problem: "missing" },
      { file: "prevalence.csv", problem: "unpinned" },
    ]);
  });

  it("reads a checksum file written with Windows line endings", () => {
    const dir = dataDir({
      "sources.sha256": PINNED.replace(/\n/g, "\r\n"),
      "cmudict.dict": "abc",
      "words.txt": "",
      "names.txt": "abc",
      "prevalence.csv": "",
    });
    expect(checkLocalSources(dir)).toEqual([]);
  });

  it("refuses the build with the file and both ways to fix it", () => {
    const message = buildRefusal([{ file: "prevalence.csv", problem: "mismatch" }]);
    expect(message).toMatch(/prevalence\.csv/);
    expect(message).toMatch(/npm run sources:fetch/);
    expect(message).toMatch(/npm run sources:upload -- prevalence\.csv/);
  });
});

describe("the fetch", () => {
  const mirror = (objects: Record<string, string>) => {
    const asked: string[] = [];
    const download = async (key: string): Promise<Uint8Array> => {
      asked.push(key);
      const body = objects[key];
      if (body === undefined) throw new Error(`no object ${key}`);
      return Buffer.from(body);
    };
    return { asked, download };
  };

  it("writes the four index sources from the mirror's prefix when every one matches, and nothing else", async () => {
    // CI fetches before every deploy and monthly run, and builds from the four
    // alone: it must not need, or download, the Wiktionary extract.
    const dir = dataDir({ "sources.sha256": PINNED });
    const { asked, download } = mirror({
      "sources/cmudict.dict": "abc",
      "sources/words.txt": "",
      "sources/names.txt": "abc",
      "sources/prevalence.csv": "",
    });

    const result = await fetchSources(dir, download);

    expect(result).toEqual({ fetched: [...INDEX_SOURCES], kept: [], faults: [] });
    expect(asked).toHaveLength(4);
    expect(checkLocalSources(dir)).toEqual([]);
  });

  it("fetches the Wiktionary extract only when it is asked for", async () => {
    const dir = dataDir({ "sources.sha256": PINNED, "cmudict.dict": "abc", "words.txt": "", "names.txt": "abc", "prevalence.csv": "" });
    const { asked, download } = mirror({ "sources/wiktionary.tsv": "abc" });

    const result = await fetchSources(dir, download, [WIKTIONARY_SOURCE]);

    expect(SOURCE_FILES).toContain("wiktionary.tsv");
    expect(result).toEqual({ fetched: ["wiktionary.tsv"], kept: [], faults: [] });
    expect(asked).toEqual(["sources/wiktionary.tsv"]);
    expect(checkLocalSources(dir, [WIKTIONARY_SOURCE])).toEqual([]);
  });

  it("names the sources a fetch is asked for, refusing a name the mirror does not hold", () => {
    expect(fetchedFiles([])).toEqual([...INDEX_SOURCES]);
    expect(fetchedFiles(["wiktionary.tsv"])).toEqual(["wiktionary.tsv"]);
    expect(fetchedFiles(["--with-wiktionary"])).toEqual([...INDEX_SOURCES, "wiktionary.tsv"]);
    expect(() => fetchedFiles(["wiktionary.csv"])).toThrow(/wiktionary\.csv/);
  });

  it("refuses, and writes nothing, when any one fails its checksum", async () => {
    const dir = dataDir({ "sources.sha256": PINNED, "words.txt": "local copy" });
    const { download } = mirror({
      "sources/cmudict.dict": "abc",
      "sources/words.txt": "",
      "sources/names.txt": "tampered",
      "sources/prevalence.csv": "",
      "sources/wiktionary.tsv": "abc",
    });

    const result = await fetchSources(dir, download);

    expect(result.faults).toEqual([{ file: "names.txt", problem: "mismatch" }]);
    expect(result.fetched).toEqual([]);
    expect(existsSync(join(dir, "cmudict.dict"))).toBe(false);
    expect(readFileSync(join(dir, "words.txt"), "utf8")).toBe("local copy");
  });

  it("does not download a source whose local copy already matches", async () => {
    const dir = dataDir({ "sources.sha256": PINNED, "cmudict.dict": "abc", "names.txt": "abc", "wiktionary.tsv": "abc" });
    const { asked, download } = mirror({
      "sources/words.txt": "",
      "sources/prevalence.csv": "",
    });

    const result = await fetchSources(dir, download);

    expect(result).toEqual({
      fetched: ["words.txt", "prevalence.csv"],
      kept: ["cmudict.dict", "names.txt"],
      faults: [],
    });
    expect(asked).toEqual(["sources/words.txt", "sources/prevalence.csv"]);
  });

  it("refuses a source with no committed checksum without asking the mirror for it", async () => {
    const dir = dataDir({ "sources.sha256": `${ABC}  cmudict.dict\n` });
    const { asked, download } = mirror({ "sources/cmudict.dict": "abc" });

    const result = await fetchSources(dir, download);

    expect(result.faults.map((fault) => fault.problem)).toEqual(["unpinned", "unpinned", "unpinned"]);
    expect(asked).toEqual(["sources/cmudict.dict"]);
    expect(existsSync(join(dir, "cmudict.dict"))).toBe(false);
  });
});

describe("the upload's checksum rewrite", () => {
  it("replaces one source's line and leaves the others as they were", () => {
    expect(withChecksum(PINNED, "names.txt", EMPTY)).toBe(
      `${ABC}  cmudict.dict\n${EMPTY}  words.txt\n${EMPTY}  names.txt\n${EMPTY}  prevalence.csv\n${ABC}  wiktionary.tsv\n`,
    );
  });

  it("adds a line for a source not yet pinned, in the canonical order", () => {
    expect(withChecksum(`${ABC}  prevalence.csv\n`, "cmudict.dict", EMPTY)).toBe(
      `${EMPTY}  cmudict.dict\n${ABC}  prevalence.csv\n`,
    );
  });
});
