/**
 * Build the pinned Wiktionary extract (#268) from Kaikki's Wiktextract dump of
 * the English Wiktionary.
 *
 *   npx tsx scripts/extract-wiktionary.ts <kaikki.org-dictionary-English.jsonl.gz> --dated <YYYY-MM-DD>
 *
 * The dump is https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz
 * (about 530 MB). Download it into a directory of its own (`data/kaikki/` is
 * git-ignored with the rest of `data/`) and pass its path; `--dated` is the
 * dump's date, from Kaikki's page or the file's Last-Modified header, and is
 * written into the extract's header.
 *
 * It writes `data/wiktionary.tsv`: every General American and US transcription
 * of a lower-case English headword (`src/wiktionary.ts`, `extractLines`). Then
 * pin it like any other source:
 *
 *   npm run sources:upload -- wiktionary.tsv
 *
 * which uploads it to the mirror and rewrites its line in `data/sources.sha256`.
 * The dump is read as data and never run.
 */

import { createReadStream, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import { extractLines, serialiseWiktionaryExtract } from "../src/wiktionary.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "data", "wiktionary.tsv");

const argv = process.argv.slice(2);
const dumpPath = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--dated");
const dated = argv[argv.indexOf("--dated") + 1];
if (!dumpPath || argv.indexOf("--dated") < 0 || !dated || !/^\d{4}-\d{2}-\d{2}$/.test(dated)) {
  console.error("usage: extract-wiktionary <kaikki.org-dictionary-English.jsonl.gz> --dated <YYYY-MM-DD>");
  process.exit(2);
}

const input = createReadStream(resolve(dumpPath));
const lines = createInterface({ input: dumpPath.endsWith(".gz") ? input.pipe(createGunzip()) : input, crlfDelay: Infinity });

const kept: [string, string][] = [];
let entries = 0;
for await (const line of lines) {
  entries++;
  // Most entries carry no American transcription; skip them before parsing.
  if (!line.includes('"US"') && !line.includes('"General-American"')) continue;
  kept.push(...extractLines(JSON.parse(line)));
}

writeFileSync(
  out,
  serialiseWiktionaryExtract(
    kept,
    `General American and US transcriptions from the English Wiktionary, read through Kaikki's Wiktextract dump of ${dated}.`,
    "https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz. Licence CC BY-SA 4.0 and GFDL (THIRD-PARTY-NOTICES.md).",
    "Built by scripts/extract-wiktionary.ts (#268). Read by a Batch only, never shipped in the Rhyme Index.",
  ),
);
const words = new Set(kept.map(([w]) => w)).size;
console.log(`Read ${entries} entries; wrote ${words} words to data/wiktionary.tsv.`);
console.log("Pin it with: npm run sources:upload -- wiktionary.tsv");
