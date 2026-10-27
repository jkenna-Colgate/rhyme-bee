/**
 * Serialise a built index to a plain JSON artifact and back. The pipeline builds
 * this artifact once from pinned raw data; at runtime the index loads from the
 * local artifact with no network call (story 42). Maps and Sets do not survive
 * JSON, so they are stored as arrays and rehydrated here.
 */

import type { Pronunciation, RhymeKey } from "./phonology.ts";
import {
  RhymeIndex,
  type RhymeIndexConfig,
  type RhymeIndexData,
} from "./rhymeIndex.ts";

export interface SerialisedIndex {
  /** Pinned source versions, for reproducibility (story 35). */
  sources: Record<string, string>;
  pronunciations: [string, Pronunciation[]][];
  /** Absent from an artifact built before #260, which reads every word as written. */
  unmergedReadings?: [string, Pronunciation[]][];
  words: string[];
  names: string[];
  prevalence: [string, number][];
  /** Absent from an artifact built before #259, which lists no Unconfirmed Rhyme. */
  unconfirmedRhymes?: [string, RhymeKey[]][];
  config: RhymeIndexConfig;
}

export function serialise(
  data: RhymeIndexData,
  config: RhymeIndexConfig,
  sources: Record<string, string>,
): SerialisedIndex {
  return {
    sources,
    pronunciations: [...data.pronunciations.entries()],
    unmergedReadings: [...(data.unmergedReadings ?? new Map()).entries()],
    words: [...data.words],
    names: [...data.names],
    prevalence: [...data.prevalence.entries()],
    unconfirmedRhymes: [...(data.unconfirmedRhymes ?? new Map()).entries()],
    config,
  };
}

export function deserialise(artifact: SerialisedIndex): RhymeIndex {
  const data: RhymeIndexData = {
    pronunciations: new Map(artifact.pronunciations),
    unmergedReadings: new Map(artifact.unmergedReadings ?? []),
    words: new Set(artifact.words),
    names: new Set(artifact.names),
    prevalence: new Map(artifact.prevalence),
    unconfirmedRhymes: new Map(artifact.unconfirmedRhymes ?? []),
  };
  return new RhymeIndex(data, artifact.config);
}
