/**
 * Look up words or a Rhyme Key in the built Rhyme Index, so nobody writes a
 * throwaway script to ask what the index thinks of `tear` (#245).
 *
 *   npx tsx scripts/lookup.ts tear marx
 *   npx tsx scripts/lookup.ts --key "IH R"
 *
 * Through tsx rather than `npm run`, for the PowerShell separator problem
 * described at the top of `play.ts`. `--help` prints both forms.
 *
 * The imperative shell: it loads the index and what the build knew about where
 * readings came from, then hands both to `indexLookup.ts`, which is tested.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCmudict } from "../src/cmudict.ts";
import { parseDemotions } from "../src/demotions.ts";
import type { DerivedWord } from "../src/coverage.ts";
import { loadRhymeIndex } from "../src/loader.ts";
import { indexArtifactPath } from "./indexArtifact.ts";
import {
  formatFamilyLookup,
  formatWordLookup,
  LOOKUP_HELP,
  lookUpFamily,
  lookUpWord,
  parseLookupArgs,
  type BuildProvenance,
  type LookupArgs,
} from "./indexLookup.ts";

let args: LookupArgs;
try {
  args = parseLookupArgs(process.argv.slice(2));
} catch (error) {
  console.error(`${(error as Error).message}\n\n${LOOKUP_HELP}`);
  process.exit(1);
}

if (args.kind === "help") {
  console.log(LOOKUP_HELP);
  process.exit(0);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distData = resolve(root, "dist-data");
const index = loadRhymeIndex(indexArtifactPath(distData));

if (args.kind === "key") {
  console.log(formatFamilyLookup(lookUpFamily(index, args.rhymeKey)));
} else {
  const provenance = loadProvenance();
  console.log(args.words.map((word) => formatWordLookup(lookUpWord(index, word, provenance))).join("\n\n"));
}

function loadProvenance(): BuildProvenance {
  const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");
  const supplement = read(resolve(root, "data", "supplement.dict"))
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
  const derivedReport = read(resolve(distData, "derived-report.json"));
  const derived: DerivedWord[] = derivedReport === "" ? [] : JSON.parse(derivedReport);
  return {
    supplemented: new Set(parseCmudict(supplement).keys()),
    derived: new Map(derived.map(({ word, stem, rule }) => [word, { stem, rule }])),
    demotions: new Map(
      parseDemotions(read(resolve(root, "data", "demotions.txt"))).map(({ word, reason }) => [word, reason]),
    ),
  };
}
