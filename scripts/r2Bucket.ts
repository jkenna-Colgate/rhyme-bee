/**
 * Just enough of R2's S3-compatible API to list a prefix and read the objects
 * under it — signing, listing, fetching. Read-only by construction: there is no
 * PUT or DELETE here, matching the scoped read-only token the pull is given.
 *
 * Hand-rolled rather than pulled from an SDK. The whole surface is two GETs, the
 * signing is a documented recipe, and this repository's four dev dependencies are
 * not worth trading for it — the same reasoning that has `candidatesArgs.ts`
 * parsing its own flags.
 *
 * Wrangler is not an option even though it is already here: `wrangler r2 object`
 * can get, put and delete a *named* object but cannot list a bucket, and the pull
 * has to enumerate a batch it does not know the keys of.
 *
 * The signing and the listing parse are pure and tested; only `listObjects` and
 * `getObject` touch the network.
 */

import { createHash, createHmac } from "node:crypto";
import type { R2Credentials } from "./appealPull.ts";

const ALGORITHM = "AWS4-HMAC-SHA256";
/** R2 has no regions, but SigV4 demands one and R2 documents this value. */
const REGION = "auto";
const SERVICE = "s3";
/** Every request here is a GET, so the payload is always empty. */
const EMPTY_PAYLOAD_SHA256 = createHash("sha256").update("").digest("hex");

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/**
 * RFC 3986 percent-encoding, which is stricter than `encodeURIComponent`: `!`,
 * `'`, `(`, `)` and `*` are escaped too. S3 canonicalisation is byte-exact, so a
 * near-miss here is an opaque `SignatureDoesNotMatch` rather than a hint.
 */
export function uriEncode(value: string, encodeSlash: boolean): string {
  let out = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const char = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-._~]/.test(char)) out += char;
    else if (char === "/") out += encodeSlash ? "%2F" : "/";
    else out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

/** `20260805T190000Z` — the instant, stripped to what SigV4 wants. */
function amzDate(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

/**
 * Sign a GET against the bucket's S3 endpoint. `path` is the un-encoded object
 * path (`/rhyme-bee-flags/flags/…json`); `query` is signed as given.
 */
export function signGet(
  credentials: R2Credentials,
  path: string,
  query: Record<string, string>,
  now: Date,
): SignedRequest {
  const host = `${credentials.accountId}.r2.cloudflarestorage.com`;
  const stamp = amzDate(now);
  const day = stamp.slice(0, 8);
  const scope = `${day}/${REGION}/${SERVICE}/aws4_request`;

  const canonicalPath = path
    .split("/")
    .map((segment) => uriEncode(segment, true))
    .join("/");

  const canonicalQuery = Object.keys(query)
    .sort()
    .map((key) => `${uriEncode(key, true)}=${uriEncode(query[key] ?? "", true)}`)
    .join("&");

  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": EMPTY_PAYLOAD_SHA256,
    "x-amz-date": stamp,
  };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((name) => `${name}:${headers[name]}\n`)
    .join("");

  const canonicalRequest = [
    "GET",
    canonicalPath,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    EMPTY_PAYLOAD_SHA256,
  ].join("\n");

  const stringToSign = [ALGORITHM, stamp, scope, sha256Hex(canonicalRequest)].join("\n");

  const signingKey = [day, REGION, SERVICE, "aws4_request"].reduce<Buffer | string>(
    (key, part) => hmac(key, part),
    "AWS4" + credentials.secretAccessKey,
  );
  const signature = hmac(signingKey, stringToSign).toString("hex");

  return {
    url: `https://${host}${canonicalPath}${canonicalQuery === "" ? "" : `?${canonicalQuery}`}`,
    headers: {
      ...headers,
      Authorization:
        `${ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export interface Listing {
  /** The keys in this page, in the order S3 returned them — lexicographic. */
  keys: string[];
  /** The token for the next page, or null when this was the last one. */
  nextToken: string | null;
}

/**
 * Read a ListObjectsV2 response. Keys are taken only from inside `<Contents>`,
 * so a `<CommonPrefixes>` block or the echoed request prefix can never be
 * mistaken for an object.
 */
export function parseListing(xml: string): Listing {
  const keys: string[] = [];
  for (const [, block] of xml.matchAll(/<Contents\b[^>]*>([\s\S]*?)<\/Contents>/g)) {
    const key = /<Key>([\s\S]*?)<\/Key>/.exec(block ?? "");
    if (key?.[1] !== undefined) keys.push(decodeEntities(key[1]));
  }

  const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
  const token = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml);

  return {
    keys,
    nextToken: truncated && token?.[1] !== undefined ? decodeEntities(token[1]) : null,
  };
}

/** The S3 `<Code>` from an error body, so a failure names its own cause. */
function errorCode(body: string): string {
  return /<Code>([\s\S]*?)<\/Code>/.exec(body)?.[1] ?? "no error code";
}

async function get(request: SignedRequest, what: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(request.url, { headers: request.headers });
  } catch (cause) {
    throw new Error(`Could not reach R2 to ${what}. Is this machine online?`, { cause });
  }
  if (!response.ok) {
    throw new Error(
      `R2 refused to ${what}: ${response.status} ${response.statusText} ` +
        `(${errorCode(await response.text())}).`,
    );
  }
  return response;
}

/**
 * Every key under `prefix`, following continuation tokens to the end. The keys
 * come back in the order R2 lists them, which is lexicographic — and because the
 * timestamp leads each key, that is also chronological.
 */
export async function listObjects(
  credentials: R2Credentials,
  prefix: string,
): Promise<string[]> {
  const keys: string[] = [];
  let token: string | null = null;

  do {
    const query: Record<string, string> = { "list-type": "2", prefix };
    if (token !== null) query["continuation-token"] = token;

    const response = await get(
      signGet(credentials, `/${credentials.bucket}`, query, new Date()),
      `list ${credentials.bucket}`,
    );
    const page: Listing = parseListing(await response.text());
    keys.push(...page.keys);
    token = page.nextToken;
  } while (token !== null);

  return keys;
}

/** One object's body as text. */
export async function getObject(credentials: R2Credentials, key: string): Promise<string> {
  const response = await get(
    signGet(credentials, `/${credentials.bucket}/${key}`, {}, new Date()),
    `read ${key}`,
  );
  return response.text();
}
