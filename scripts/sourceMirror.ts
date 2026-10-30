/**
 * The private source mirror's checksums (#272, ADR-0013 amended 2026-10-26).
 *
 * `npm run build:index` reads four files git does not hold. They are mirrored in
 * the private R2 bucket, and a SHA-256 of each is committed, so the laptop and
 * CI build from the same bytes and an upstream edit cannot reach a verdict
 * between two deploys.
 *
 * **The checksums are a file of their own, `data/sources.sha256`, not a field
 * of `data/sources.json`.** `sources.json` is serialised into the index, so a
 * checksum written there would change the index hash every time a source moved,
 * and would make the provenance record and the pin one file with two jobs. The
 * checksum file is in `sha256sum` format, so `sha256sum -c sources.sha256` run in
 * `data/` checks it with no code of ours.
 *
 * The files' contents are never printed. Everything here reports file names and
 * digests only, because the prevalence norms are licensed for academic use and
 * a log is a publication.
 *
 * The mirror holds a fifth file the build does not read: `wiktionary.tsv`, the
 * Wiktionary extract a Batch's No False Accepts hunt reads (#268). It is uploaded
 * and checksummed with the other four, but it is fetched only when asked for by
 * name and checked only by a Batch, so neither a build nor CI, which fetches
 * before every deploy and monthly run, waits on a file it does not use.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** The four sources the Rhyme Index is built from, which `build:index` checks. */
export const INDEX_SOURCES = ["cmudict.dict", "words.txt", "names.txt", "prevalence.csv"] as const;

/** The pinned Wiktionary extract (#268), read at Batch time and never shipped in the index. */
export const WIKTIONARY_SOURCE = "wiktionary.tsv";

/** Every source the mirror holds, in the order the checksum file lists them. */
export const SOURCE_FILES = [...INDEX_SOURCES, WIKTIONARY_SOURCE] as const;
export type SourceFile = (typeof SOURCE_FILES)[number];

/** The committed checksum file, in `data/`. */
export const CHECKSUM_FILE = "sources.sha256";

export interface SourceFault {
  file: SourceFile;
  /** Absent; present with other bytes; or present with no committed checksum. */
  problem: "missing" | "mismatch" | "unpinned";
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** `<hex>  <name>` per line, as `sha256sum` writes it. Unknown lines are ignored. */
export function parseChecksums(text: string): Map<string, string> {
  const pinned = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) pinned.set(match[2], match[1]);
  }
  return pinned;
}

/** Each source against its checksum, reading its bytes through `read` (null when absent). */
export function sourceFaults(
  checksums: string,
  read: (file: SourceFile) => Uint8Array | null,
  files: readonly SourceFile[] = SOURCE_FILES,
): SourceFault[] {
  const pinned = parseChecksums(checksums);
  const faults: SourceFault[] = [];
  for (const file of files) {
    const expected = pinned.get(file);
    if (expected === undefined) {
      faults.push({ file, problem: "unpinned" });
      continue;
    }
    const bytes = read(file);
    if (bytes === null) faults.push({ file, problem: "missing" });
    else if (sha256(bytes) !== expected) faults.push({ file, problem: "mismatch" });
  }
  return faults;
}

const PROBLEM: Record<SourceFault["problem"], string> = {
  missing: "is missing",
  mismatch: "does not match its committed checksum",
  unpinned: "has no committed checksum",
};

/**
 * Why `build:index` will not build, and the two ways out. Which one is right
 * depends on what the maintainer meant, so both are given: fetch if the local
 * copy drifted, upload if the change to it was deliberate.
 */
export function buildRefusal(faults: SourceFault[]): string {
  const lines = faults.map((fault) => `  data/${fault.file} ${PROBLEM[fault.problem]}.`);
  const files = faults.map((fault) => fault.file).join(" ");
  return (
    `Refusing to build the Rhyme Index: a source is not the one data/${CHECKSUM_FILE} pins.\n` +
    `${lines.join("\n")}\n\n` +
    "The laptop and CI must build from the same bytes (ADR-0013, amended 2026-10-26).\n" +
    "To build from the mirrored sources, fetch them:\n\n" +
    "    npm run sources:fetch\n\n" +
    "If you changed a source on purpose, upload it, which rewrites its checksum, then commit:\n\n" +
    `    npm run sources:upload -- ${files}\n`
  );
}

function readChecksums(dataDir: string): string {
  const path = resolve(dataDir, CHECKSUM_FILE);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function readLocal(dataDir: string, file: SourceFile): Uint8Array | null {
  const path = resolve(dataDir, file);
  return existsSync(path) ? readFileSync(path) : null;
}

/**
 * The laptop check: the local copies in `dataDir` against the committed
 * checksums. The index's four by default, which is the build's check; a Batch
 * checks the Wiktionary extract the same way.
 */
export function checkLocalSources(dataDir: string, files: readonly SourceFile[] = INDEX_SOURCES): SourceFault[] {
  return sourceFaults(readChecksums(dataDir), (file) => readLocal(dataDir, file), files);
}

/** Where a source sits in the bucket. Its own prefix, apart from the Appeals under `flags/`. */
export function mirrorKey(file: SourceFile): string {
  return `sources/${file}`;
}

export interface FetchResult {
  /** Downloaded and written to `data/`. */
  fetched: SourceFile[];
  /** Already matching locally, so not downloaded. */
  kept: SourceFile[];
  /** Why the fetch refused. When there are any, nothing was written. */
  faults: SourceFault[];
}

/** The flag that fetches the Wiktionary extract as well as the index's four. */
export const WITH_WIKTIONARY = "--with-wiktionary";

/**
 * The sources `sources:fetch` brings down, from its arguments: the index's four
 * when none is named, the files named when some are, and the four with the
 * Wiktionary extract under `--with-wiktionary`. A name the mirror does not
 * hold is refused rather than ignored.
 */
export function fetchedFiles(args: readonly string[]): SourceFile[] {
  const named = args.filter((a) => a !== WITH_WIKTIONARY);
  for (const name of named) {
    if (!(SOURCE_FILES as readonly string[]).includes(name)) {
      throw new Error(`${name} is not a source the mirror holds (${SOURCE_FILES.join(", ")}).`);
    }
  }
  const files: SourceFile[] = named.length > 0 ? (named as SourceFile[]) : [...INDEX_SOURCES];
  if (args.includes(WITH_WIKTIONARY) && !files.includes(WIKTIONARY_SOURCE)) files.push(WIKTIONARY_SOURCE);
  return files;
}

/**
 * Bring `files` in `data/` into line with the committed checksums from the
 * mirror: the index's four unless others are asked for.
 *
 * Every download is checked before any file is written, so a refusal leaves
 * `data/` exactly as it was rather than half-updated. A local copy that already
 * matches is kept and not downloaded, which makes a repeat run on the laptop
 * cost nothing. A failed download throws, and also writes nothing.
 */
export async function fetchSources(
  dataDir: string,
  download: (key: string) => Promise<Uint8Array>,
  files: readonly SourceFile[] = INDEX_SOURCES,
): Promise<FetchResult> {
  const checksums = readChecksums(dataDir);
  const pinned = parseChecksums(checksums);

  const kept: SourceFile[] = [];
  const downloaded = new Map<SourceFile, Uint8Array>();
  for (const file of files) {
    const expected = pinned.get(file);
    if (expected === undefined) continue;
    const local = readLocal(dataDir, file);
    if (local !== null && sha256(local) === expected) kept.push(file);
    else downloaded.set(file, await download(mirrorKey(file)));
  }

  const faults = sourceFaults(
    checksums,
    (file) => downloaded.get(file) ?? readLocal(dataDir, file),
    files,
  );
  if (faults.length > 0) return { fetched: [], kept, faults };

  for (const [file, bytes] of downloaded) writeFileSync(resolve(dataDir, file), bytes);
  return { fetched: [...downloaded.keys()], kept, faults: [] };
}

/**
 * The checksum file with `file` pinned to `digest`: its line replaced, or added,
 * and the lines kept in `SOURCE_FILES` order so a rewrite is a one-line diff.
 */
export function withChecksum(checksums: string, file: SourceFile, digest: string): string {
  const pinned = parseChecksums(checksums);
  pinned.set(file, digest);
  return SOURCE_FILES.filter((name) => pinned.has(name))
    .map((name) => `${pinned.get(name)}  ${name}\n`)
    .join("");
}
