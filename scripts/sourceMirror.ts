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
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** The four sources the mirror holds, in the order the checksum file lists them. */
export const SOURCE_FILES = ["cmudict.dict", "words.txt", "names.txt", "prevalence.csv"] as const;
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
): SourceFault[] {
  const pinned = parseChecksums(checksums);
  const faults: SourceFault[] = [];
  for (const file of SOURCE_FILES) {
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

/** The laptop check: the local copies in `dataDir` against the committed checksums. */
export function checkLocalSources(dataDir: string): SourceFault[] {
  return sourceFaults(readChecksums(dataDir), (file) => readLocal(dataDir, file));
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

/**
 * Bring `data/` into line with the committed checksums from the mirror.
 *
 * Every download is checked before any file is written, so a refusal leaves
 * `data/` exactly as it was rather than half-updated. A local copy that already
 * matches is kept and not downloaded, which makes a repeat run on the laptop
 * cost nothing. A failed download throws, and also writes nothing.
 */
export async function fetchSources(
  dataDir: string,
  download: (key: string) => Promise<Uint8Array>,
): Promise<FetchResult> {
  const checksums = readChecksums(dataDir);
  const pinned = parseChecksums(checksums);

  const kept: SourceFile[] = [];
  const downloaded = new Map<SourceFile, Uint8Array>();
  for (const file of SOURCE_FILES) {
    const expected = pinned.get(file);
    if (expected === undefined) continue;
    const local = readLocal(dataDir, file);
    if (local !== null && sha256(local) === expected) kept.push(file);
    else downloaded.set(file, await download(mirrorKey(file)));
  }

  const faults = sourceFaults(checksums, (file) =>
    downloaded.get(file) ?? readLocal(dataDir, file),
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
