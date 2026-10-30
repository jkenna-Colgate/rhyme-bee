/**
 * Upload index sources to the private mirror and pin their checksums.
 *
 *   npm run sources:upload -- prevalence.csv
 *   npm run sources:upload -- cmudict.dict words.txt names.txt prevalence.csv wiktionary.tsv
 *
 * `wiktionary.tsv` is the Batch's Wiktionary extract (#268), built by
 * `scripts/extract-wiktionary.ts`; the build does not read it.
 *
 * Changing a source is: replace the file in `data/`, run this, commit
 * `data/sources.sha256`, push. Each file is uploaded first and its line in the
 * checksum file rewritten only once the upload has succeeded, so the committed
 * checksum never names bytes the mirror does not hold.
 *
 * The upload goes through `wrangler r2 object put --remote`, on the maintainer's
 * `wrangler login` (or a `CLOUDFLARE_API_TOKEN` that can write R2). It is the
 * one write here, and it is deliberately not in `r2Bucket.ts`, which stays
 * read-only to match the read-only token the fetch and the Appeal pull use.
 *
 * The bucket is the private one the Appeals land in, under its own `sources/`
 * prefix, or `R2_BUCKET` when set: the same resolution the fetch makes, so the
 * two cannot address different buckets.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APPEAL_BUCKET, parseEnvFile } from "./appealPull.ts";
import {
  CHECKSUM_FILE,
  mirrorKey,
  sha256,
  SOURCE_FILES,
  withChecksum,
  type SourceFile,
} from "./sourceMirror.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(root, "data");
const checksumPath = resolve(dataDir, CHECKSUM_FILE);
const credentialsPath = resolve(root, "credentials.env");

const settings: Record<string, string | undefined> = {
  ...parseEnvFile(existsSync(credentialsPath) ? readFileSync(credentialsPath, "utf8") : ""),
  ...process.env,
};
const bucket = (settings.R2_BUCKET ?? "").trim() || APPEAL_BUCKET;
// It goes into a shell command line, so it must be a bare bucket name.
if (!/^[A-Za-z0-9-]+$/.test(bucket)) {
  console.error(`R2_BUCKET is ${JSON.stringify(bucket)}, which is not a bucket name.`);
  process.exit(1);
}

function isSource(name: string): name is SourceFile {
  return (SOURCE_FILES as readonly string[]).includes(name);
}

const files = process.argv.slice(2);
if (files.length === 0 || !files.every(isSource)) {
  console.error(
    "Name the sources to upload, from: " + SOURCE_FILES.join(", ") + ".\n" +
      "  npm run sources:upload -- prevalence.csv",
  );
  process.exit(1);
}

for (const file of files as SourceFile[]) {
  const path = resolve(dataDir, file);
  if (!existsSync(path)) {
    console.error(`data/${file} does not exist here, so there is nothing to upload.`);
    process.exit(1);
  }
  const digest = sha256(readFileSync(path));
  const target = `${bucket}/${mirrorKey(file)}`;

  console.log(`Uploading data/${file} to ${target}…`);
  const { status } = spawnSync(
    `npx wrangler r2 object put "${target}" --file "${path}" ` +
      "--content-type application/octet-stream --remote",
    { cwd: resolve(root, "web"), shell: true, stdio: "inherit" },
  );
  if (status !== 0) {
    console.error(`The upload of ${file} failed, so its checksum was left as it was.`);
    process.exit(status ?? 1);
  }

  const checksums = existsSync(checksumPath) ? readFileSync(checksumPath, "utf8") : "";
  writeFileSync(checksumPath, withChecksum(checksums, file, digest));
  console.log(`Pinned ${file} at ${digest}.`);
}

console.log(`\nNow commit data/${CHECKSUM_FILE} and push.`);
