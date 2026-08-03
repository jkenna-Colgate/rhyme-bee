/**
 * The built-artifact round trip: serialising the index and reading it back must
 * yield identical verdicts, so a rebuild does not silently change adjudication.
 */

import { describe, expect, it } from "vitest";
import { buildTestIndex, KNOWNNESS_THRESHOLD } from "../__fixtures__/index.ts";
import { deserialise, serialise } from "../serialise.ts";

describe("serialise / deserialise", () => {
  const config = { knownnessThreshold: KNOWNNESS_THRESHOLD };
  // Through the whole build, so `data` is what a real build serialises —
  // normalised readings, not the raw fixture (ADR-0010).
  const { index: direct, data } = buildTestIndex();
  const roundTripped = deserialise(
    // A JSON.parse(JSON.stringify(...)) hop proves it survives a real write/read.
    JSON.parse(JSON.stringify(serialise(data, config, { cmudict: "test" }))),
  );

  it.each(["late", "objurgate", "Kate", "hat", "sate"])(
    "adjudicates %j identically before and after a round trip",
    (submission) => {
      const seed = direct.pinSeed("ate");
      expect(roundTripped.adjudicate(roundTripped.pinSeed("ate"), submission)).toEqual(
        direct.adjudicate(seed, submission),
      );
    },
  );
});
