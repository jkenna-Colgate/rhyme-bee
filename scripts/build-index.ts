/**
 * Offline pipeline: build the Rhyme Index artifact from pinned raw data.
 *
 *   npm run build:index
 *
 * Reads the raw inputs from `data/` (uncommitted — see .gitignore and
 * data/README.md), writes the built artifact and the dropped-words and
 * derived-words reports to `dist-data/`. Rebuilding from the same pinned inputs
 * yields the same verdicts (story 35); nothing here touches the network.
 *
 * The index itself is written content-addressed, as `index-<hash>.json` plus a
 * manifest naming it — see `indexArtifact.ts` for why, and for why the manifest
 * is generated but deliberately unread at runtime.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manufactureIndexData } from "../src/manufacture.ts";
import { serialise } from "../src/serialise.ts";
import { DEFAULT_SCORING_CONFIG } from "../src/scoring.ts";
import { checkTierSentinels } from "../src/tierOverride.ts";
import { MANIFEST_FILENAME, writeIndexArtifact } from "./indexArtifact.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(root, "data");
const outDir = resolve(root, "dist-data");

// Default sits between the two probe words so `defenestrate` (+0.25) is an
// Answer and `objurgate` (-0.43) is a Bonus Word — see ADR-0003's Resolution.
// Still tunable per build via the env var, and to be sharpened by human review.
const KNOWNNESS_THRESHOLD = Number(process.env.KNOWNNESS_THRESHOLD ?? "0.0");

// The Retrieval override layer's build-time guard (ADR-0015), run before a
// single byte of data is read. Storing a prevalence value rather than a
// verdict is what keeps the tiering path single, and the guard is the price of
// that choice: it asks whether the two knobs a sentinel's meaning depends on —
// `KNOWNNESS_THRESHOLD` here and the rare-Answer cutoff in the shipped scoring
// config — still land every sentinel on the Tier and rarity it was chosen for.
// A moved knob must fail the build loudly, naming the sentinel and the knob,
// rather than silently re-tiering every word the editor ever judged.
const sentinelFaults = checkTierSentinels({
  knownnessThreshold: KNOWNNESS_THRESHOLD,
  scoring: DEFAULT_SCORING_CONFIG,
});
if (sentinelFaults.length > 0) {
  const lines = sentinelFaults.map(
    (fault) =>
      `  "${fault.verdict}" (${fault.value}) was chosen to be ${fault.expected}, but the ` +
      `current "${fault.knob}" makes it ${fault.actual}.`,
  );
  throw new Error(
    `Tier override sentinel check failed — a scoring knob has moved underneath a committed ` +
      `override (ADR-0015):\n${lines.join("\n")}`,
  );
}

function read(name: string): string {
  return readFileSync(resolve(dataDir, name), "utf8");
}

/**
 * Like `read`, but a missing file is a legitimate no-op rather than a build
 * error. Only `tier-overrides.csv` uses this: unlike the other pinned inputs,
 * it may never have been written at all — no Editor's Pass has necessarily
 * happened yet — and that absence means "no overrides", not "broken build".
 */
function readOptional(name: string): string {
  return existsSync(resolve(dataDir, name)) ? read(name) : "";
}

const sources = JSON.parse(read("sources.json")) as Record<string, string>;

// The whole stage order lives behind this one call — demotions, supplement,
// coverage, normalisation, the Retrieval override layer — so the script cannot
// run them out of turn, twice, or not at all. Its job from here is files in,
// files out. See src/manufacture.ts.
const { data, demoted, derived, dropped, overridden } = manufactureIndexData({
  cmudict: read("cmudict.dict"),
  words: read("words.txt"),
  names: read("names.txt"),
  prevalence: read("prevalence.csv"),
  demotions: read("demotions.txt"),
  supplement: read("supplement.dict"),
  tierOverrides: readOptional("tier-overrides.csv"),
});

mkdirSync(outDir, { recursive: true });
const manifest = writeIndexArtifact(
  outDir,
  JSON.stringify(serialise(data, { knownnessThreshold: KNOWNNESS_THRESHOLD }, sources)),
);
writeFileSync(resolve(outDir, "dropped-report.json"), JSON.stringify(dropped, null, 2));

// Derived-words report (issue #76): every word coverage derivation gave a
// reading to, its stem, and the rule that produced it — so over-generation is
// visible rather than buried in the index.
writeFileSync(resolve(outDir, "derived-report.json"), JSON.stringify(derived, null, 2));

// Name the artifact first: it is what the deploy uploads and what identifies
// the judge a player is running, so it is the line worth reading off a rebuild.
console.log(`Wrote ${manifest.index} (manifest: ${MANIFEST_FILENAME}).`);
console.log(
  `Built index: ${data.pronunciations.size} pronunciations, ${data.words.size} words, ` +
    `${data.prevalence.size} prevalence entries, ${derived.length} derived, ` +
    `${dropped.length} dropped. Threshold ${KNOWNNESS_THRESHOLD}.`,
);

// A demotion whose word the upstream list no longer holds is dead weight, and
// the file is hand-maintained, so say so rather than letting it accumulate.
const stale = demoted.filter((d) => !d.hadWordhood);
console.log(
  `Demoted ${demoted.length} words (${demoted.filter((d) => d.reason === "proper-noun").length} ` +
    `proper nouns)${stale.length > 0 ? `; ${stale.length} stale: ${stale.map((d) => d.word).join(", ")}` : ""}.`,
);

// A reversed override (more than one row) is worth naming on its own — it is
// the file's own record of a word the editor changed their mind about.
const reversed = overridden.filter((o) => o.rows > 1);
console.log(
  `Tier-overrode ${overridden.length} words` +
    `${reversed.length > 0 ? ` (${reversed.length} reversed: ${reversed.map((o) => o.word).join(", ")})` : ""}.`,
);
