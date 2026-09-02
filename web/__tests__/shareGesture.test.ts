/**
 * The share gesture, through its interface: both branches and the outcome each
 * reports (#196, #204).
 *
 * The module exists in order to be testable at all. Sharing is two paths — a
 * native share sheet where the browser has one, a clipboard copy where it does
 * not — and neither is reachable from a test if the code reads `navigator` for
 * itself. So the capabilities arrive as arguments, and everything below is a
 * fake pair of them plus an assertion about what the caller is told afterwards.
 *
 * The URL is never spelled out here. Every case that has one compares against
 * `shareTargets`, because a URL asserted as a literal in this file would agree
 * with a gesture that had drifted from the build — which is precisely the
 * failure #201 exists to make impossible.
 */

import { describe, expect, it, vi } from "vitest";
import { DEFAULT_RANK_LADDER, type RankTier } from "../../src/scoring.ts";
import { shareRank, type ShareContext } from "../src/share/shareGesture.ts";
import { shareTargetFor, shareTargets } from "../src/share/shareTargets.ts";

const ORIGIN = "https://example.test";
const LAUREATE = { label: "Laureate" };

/** The URL the build wrote for a Rank, derived rather than written out. */
function urlFor(label: string, ladder: RankTier[] = DEFAULT_RANK_LADDER): string {
  const target = shareTargetFor(ladder, ORIGIN, label);
  if (target === undefined) throw new Error(`no share target for ${label}`);
  return target.url;
}

/** A browser with both gestures, either of which a case may drop or fail. */
function shareContext(overrides: Partial<ShareContext> = {}): ShareContext {
  return {
    origin: ORIGIN,
    ladder: DEFAULT_RANK_LADDER,
    share: vi.fn(async () => {}),
    copy: vi.fn(async () => {}),
    ...overrides,
  };
}

/** A rejection shaped like the one a cancelled share sheet produces. */
function abortError(): Error {
  const error = new Error("Share canceled");
  error.name = "AbortError";
  return error;
}

describe("shareRank", () => {
  describe("where a native share sheet exists", () => {
    it("uses it, and reports that it shared", async () => {
      const deps = shareContext();

      await expect(shareRank(LAUREATE, deps)).resolves.toBe("shared");
      expect(deps.share).toHaveBeenCalledTimes(1);
    });

    it("hands the composer the bare URL alone", async () => {
      const share = vi.fn(async () => {});

      await shareRank(LAUREATE, shareContext({ share }));

      // Not `toMatchObject`: the claim is that nothing accompanies the link,
      // which is a claim about the keys that are absent as much as the one present.
      expect(share).toHaveBeenCalledWith({ url: urlFor("Laureate") });
    });

    it("leaves the clipboard alone", async () => {
      const copy = vi.fn(async () => {});

      await shareRank(LAUREATE, shareContext({ copy }));

      expect(copy).not.toHaveBeenCalled();
    });

    it("reports a cancelled sheet as neither shared nor copied", async () => {
      const copy = vi.fn(async () => {});
      const share = vi.fn(async () => {
        throw abortError();
      });

      await expect(shareRank(LAUREATE, shareContext({ share, copy }))).resolves.toBe("dismissed");
      // A player who backed out of the sheet did not ask for a copy instead.
      expect(copy).not.toHaveBeenCalled();
    });

    it("falls back to the clipboard when the sheet fails for any other reason", async () => {
      const copy = vi.fn(async () => {});
      const share = vi.fn(async () => {
        throw new Error("NotAllowedError");
      });

      await expect(shareRank(LAUREATE, shareContext({ share, copy }))).resolves.toBe("copied");
      expect(copy).toHaveBeenCalledWith(urlFor("Laureate"));
    });
  });

  describe("where none exists", () => {
    it("copies the URL instead, and reports that it copied", async () => {
      const copy = vi.fn(async () => {});

      await expect(shareRank(LAUREATE, shareContext({ share: undefined, copy }))).resolves.toBe(
        "copied",
      );
      expect(copy).toHaveBeenCalledWith(urlFor("Laureate"));
    });

    it("reports a refused clipboard rather than claiming a copy", async () => {
      const copy = vi.fn(async () => {
        throw new Error("NotAllowedError: write permission denied");
      });

      await expect(shareRank(LAUREATE, shareContext({ share: undefined, copy }))).resolves.toBe(
        "failed",
      );
    });

    it("reports failure rather than throwing when the browser can do neither", async () => {
      const deps = shareContext({ share: undefined, copy: undefined });

      await expect(shareRank(LAUREATE, deps)).resolves.toBe("failed");
    });
  });

  it("shares the URL the build wrote, for every Rank on the ladder", async () => {
    for (const target of shareTargets(DEFAULT_RANK_LADDER, ORIGIN)) {
      const share = vi.fn(async () => {});

      await expect(shareRank({ label: target.label }, shareContext({ share }))).resolves.toBe(
        "shared",
      );
      expect(share).toHaveBeenCalledWith({ url: target.url });
    }
  });

  it("shares against the ladder it is given rather than the shipped one", async () => {
    const ladder: RankTier[] = [
      { threshold: 0, label: "Novice" },
      { threshold: 60, label: "Trouvère" },
    ];
    const share = vi.fn(async () => {});

    await shareRank({ label: "Trouvère" }, shareContext({ ladder, share }));

    expect(share).toHaveBeenCalledWith({ url: urlFor("Trouvère", ladder) });
  });

  it("does nothing at all for a Rank the ladder does not hold", async () => {
    const deps = shareContext();

    // No badge and no page were written for a Rank off the ladder, so there is
    // no URL to send: a link to one would 404 rather than unfurl.
    await expect(shareRank({ label: "Poet Laureate of Mars" }, deps)).resolves.toBe("failed");
    expect(deps.share).not.toHaveBeenCalled();
    expect(deps.copy).not.toHaveBeenCalled();
  });
});
