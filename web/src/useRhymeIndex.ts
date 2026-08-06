/**
 * Load the built Rhyme Index once, exposing the three states the shell must show:
 * a `loading` state during the ~14 MB fetch, a distinct `error` state if the
 * fetch or deserialise fails (never a dead page), and a `ready` state carrying
 * the `RhymeIndex`.
 */

import { useEffect, useState } from "react";
import type { RhymeIndex } from "../../src/rhymeIndex.ts";
import { loadRhymeIndex } from "./loadIndex.ts";

export type IndexLoad =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; index: RhymeIndex };

/**
 * Served from `../dist-data` via Vite's static serving (see vite.config.ts).
 *
 * The filename is content-addressed and baked into the bundle at build time, so
 * the artifact can be cached immutably and a redeployed index still reaches the
 * browser immediately — the name changes with the contents. There is no runtime
 * manifest fetch: a lookup would block this request, which is the one that
 * matters, behind another. See ADR-0013 and #117.
 */
const INDEX_URL = `${import.meta.env.BASE_URL}${__INDEX_ARTIFACT__}`;

export function useRhymeIndex(): IndexLoad {
  const [load, setLoad] = useState<IndexLoad>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    loadRhymeIndex(INDEX_URL)
      .then((index) => {
        if (!cancelled) setLoad({ status: "ready", index });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoad({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return load;
}
