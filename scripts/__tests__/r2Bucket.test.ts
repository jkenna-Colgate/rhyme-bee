/**
 * Signing and listing are the two places the pull can fail without saying
 * anything useful: a byte wrong in the canonical request is an opaque
 * `SignatureDoesNotMatch`, and a listing parsed loosely quietly returns fewer
 * keys than the bucket holds. Both are pure, so both are pinned here.
 *
 * The expected signature is a golden value computed independently (a separate
 * SigV4 implementation over the same inputs), not a value this module produced.
 * A test that re-derived it the way the code does would agree with any bug.
 */

import { describe, expect, it } from "vitest";
import type { R2Credentials } from "../appealPull.ts";
import { parseListing, signGet, uriEncode } from "../r2Bucket.ts";

const credentials: R2Credentials = {
  accountId: "abc123",
  accessKeyId: "AKID",
  secretAccessKey: "SECRET",
  bucket: "rhyme-bee-flags",
};

const AT = new Date("2026-08-05T19:00:00.000Z");

describe("signing a read of the bucket", () => {
  const signed = signGet(credentials, "/rhyme-bee-flags", { "list-type": "2", prefix: "flags/" }, AT);

  it("matches an independently computed SigV4 signature", () => {
    expect(signed.headers.Authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKID/20260805/auto/s3/aws4_request, " +
        "SignedHeaders=host;x-amz-content-sha256;x-amz-date, " +
        "Signature=8d81043d7589cc905d37e19cf07d00670bd4d6dc27f7c42ef701d62885504060",
    );
  });

  it("addresses the account's own R2 endpoint", () => {
    expect(signed.url).toBe(
      "https://abc123.r2.cloudflarestorage.com/rhyme-bee-flags?list-type=2&prefix=flags%2F",
    );
    expect(signed.headers.host).toBe("abc123.r2.cloudflarestorage.com");
  });

  it("declares the empty payload every one of these GETs carries", () => {
    expect(signed.headers["x-amz-content-sha256"]).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(signed.headers["x-amz-date"]).toBe("20260805T190000Z");
  });

  it("sorts the query, since S3 signs it canonically rather than as written", () => {
    const written = signGet(credentials, "/rhyme-bee-flags", { prefix: "flags/", "list-type": "2" }, AT);
    expect(written.url).toBe(signed.url);
    expect(written.headers.Authorization).toBe(signed.headers.Authorization);
  });

  it("leaves an object key's path separators alone while escaping the rest", () => {
    const object = signGet(
      credentials,
      "/rhyme-bee-flags/flags/2026-08-05T19-00-00-000Z-airburst.json",
      {},
      AT,
    );
    expect(object.url).toBe(
      "https://abc123.r2.cloudflarestorage.com/rhyme-bee-flags/flags/" +
        "2026-08-05T19-00-00-000Z-airburst.json",
    );
  });

  it("changes with the secret and with the day, as a signature must", () => {
    const otherKey = signGet({ ...credentials, secretAccessKey: "OTHER" }, "/rhyme-bee-flags", {}, AT);
    const otherDay = signGet(credentials, "/rhyme-bee-flags", {}, new Date("2026-08-06T19:00:00.000Z"));
    expect(otherKey.headers.Authorization).not.toBe(signed.headers.Authorization);
    expect(otherDay.headers.Authorization).not.toBe(signed.headers.Authorization);
  });
});

describe("percent-encoding for the canonical request", () => {
  it("escapes what encodeURIComponent leaves alone", () => {
    expect(uriEncode("a!'()*b", true)).toBe("a%21%27%28%29%2Ab");
  });

  it("leaves the unreserved set untouched", () => {
    expect(uriEncode("aZ09-._~", true)).toBe("aZ09-._~");
  });

  it("escapes a slash only when asked", () => {
    expect(uriEncode("flags/x", true)).toBe("flags%2Fx");
    expect(uriEncode("flags/x", false)).toBe("flags/x");
  });

  it("encodes a multi-byte character byte by byte", () => {
    expect(uriEncode("é", true)).toBe("%C3%A9");
  });
});

const page = (contents: string, extra = ""): string =>
  `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult>${contents}${extra}</ListBucketResult>`;

const entry = (key: string): string => `<Contents><Key>${key}</Key><Size>96</Size></Contents>`;

describe("reading a listing", () => {
  it("takes the keys in the order R2 returned them", () => {
    const xml = page(
      entry("flags/2026-08-05T09-00-00-000Z-airburst.json") +
        entry("flags/2026-08-05T19-00-00-000Z-overjoy.json"),
      "<IsTruncated>false</IsTruncated>",
    );
    expect(parseListing(xml)).toEqual({
      keys: [
        "flags/2026-08-05T09-00-00-000Z-airburst.json",
        "flags/2026-08-05T19-00-00-000Z-overjoy.json",
      ],
      nextToken: null,
    });
  });

  it("reads an empty bucket as no keys rather than an error", () => {
    expect(parseListing(page("", "<IsTruncated>false</IsTruncated>"))).toEqual({
      keys: [],
      nextToken: null,
    });
  });

  it("carries the continuation token on a truncated page", () => {
    const xml = page(
      entry("flags/a.json"),
      "<IsTruncated>true</IsTruncated><NextContinuationToken>abc123==</NextContinuationToken>",
    );
    expect(parseListing(xml).nextToken).toBe("abc123==");
  });

  it("ignores a stale token when the page was not truncated", () => {
    const xml = page(
      entry("flags/a.json"),
      "<IsTruncated>false</IsTruncated><NextContinuationToken>abc123==</NextContinuationToken>",
    );
    expect(parseListing(xml).nextToken).toBeNull();
  });

  it("never mistakes the echoed prefix or a common prefix for an object", () => {
    const xml = page(
      "<Name>rhyme-bee-flags</Name><Prefix>flags/</Prefix>" +
        entry("flags/a.json") +
        "<CommonPrefixes><Prefix>flags/nested/</Prefix></CommonPrefixes>",
      "<IsTruncated>false</IsTruncated>",
    );
    expect(parseListing(xml).keys).toEqual(["flags/a.json"]);
  });

  it("decodes the entities S3 escapes a key with", () => {
    const xml = page(entry("flags/a&amp;b.json"), "<IsTruncated>false</IsTruncated>");
    expect(parseListing(xml).keys).toEqual(["flags/a&b.json"]);
  });
});
