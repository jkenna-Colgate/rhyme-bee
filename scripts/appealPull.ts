/**
 * The pure half of the Appeal pull: what counts as a credential, and which
 * of the bucket's objects are new to the candidate queue.
 *
 * Deployed, a player tapping "should count" writes one R2 object per Appeal
 * (#119). This is the maintainer end of that: the objects come back down and
 * land in the *existing* queue, `data/supplement-candidates.jsonl`, exactly as
 * the dev-only button would have written them. Nothing new is invented on the
 * way — each object body is already `serialiseCandidate` output, so appending
 * the bodies in listing order yields JSON Lines that `parseCandidates` reads
 * unchanged, and `npm run supplement:candidates` never learns where a record
 * came from.
 *
 * Nothing here adjudicates, and nothing here judges. The verdict was reached in
 * the player's browser and stays there (ADR-0013); this moves a report *about* a
 * verdict from one queue to another.
 *
 * **A record's identity is its object key.** `candidateKey` derives that key from
 * the record itself, so the queue is self-describing about what has already been
 * pulled — no ledger file to drift out of step with it. Running the pull twice
 * therefore appends nothing the second time, because every key it lists is a key
 * the queue can already derive. The judged-and-archived half counts too: the
 * `--archive` flag on the judging script empties the queue into
 * `supplement-candidates.archived.jsonl`, and the pull is read-only on the
 * bucket, so the archive is the durable record of what has been seen.
 */

import {
  candidateKey,
  parseCandidates,
  serialiseCandidate,
  type SupplementCandidate,
} from "../src/supplementCandidate.ts";

/** The bucket the Appealed words land in — settled by #114, not inferred. */
export const APPEAL_BUCKET = "rhyme-bee-flags";

/**
 * What the pull needs to read the bucket from this machine. A **scoped,
 * read-only R2 API token** (#114, Step 8), not the account login: the OAuth
 * scopes `wrangler login` grants cover Workers, KV, D1 and others but include no
 * R2 scope at all, so the login cannot read the bucket. The Worker's own
 * `APPEAL_QUEUE` binding is no help either — a binding only exists inside the
 * Worker, and this runs here.
 */
export interface R2Credentials {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

const REQUIRED = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"] as const;

/**
 * What may appear in the two settings that are interpolated into the request
 * URL. `signGet` builds its host out of the account id and its path out of the
 * bucket, so a `/`, `@` or `:` in either would quietly point a signed,
 * credentialed request at some other host. Neither value is attacker-supplied —
 * both come from the maintainer's own environment — so this is not a hole being
 * closed; it makes "the destination is fixed" something the code checks rather
 * than something it assumes, and turns a typo into a named error instead of an
 * opaque `SignatureDoesNotMatch`.
 *
 * Deliberately not pinned to Cloudflare's 32-hex account id: what matters is
 * that the value cannot restructure a URL, not that it matches today's format.
 */
const URL_SAFE = /^[A-Za-z0-9-]+$/;

/**
 * Read `KEY=value` settings out of a local credentials file. Blank lines, `#`
 * comments and any line without an `=` are skipped, so a file that is half prose
 * note and half settings still reads — a missing setting is reported by
 * `readCredentials` with instructions, which is far kinder than a parse error
 * pointing at a line the maintainer wrote to themselves.
 *
 * `export ` prefixes and surrounding quotes are tolerated, so the same file can
 * be `source`d from a shell.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const settings: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = line.slice(eq + 1).trim();
    const quoted = value.length >= 2 && (value[0] === '"' || value[0] === "'");
    if (quoted && value[value.length - 1] === value[0]) value = value.slice(1, -1);

    settings[key] = value;
  }
  return settings;
}

/**
 * Resolve the credentials, or refuse with an error that says where to get each
 * missing piece. Refusing loudly matters more here than usual: the pull's other
 * failure mode is silence, and a maintainer who cannot tell "no credential" from
 * "no Appeals today" will read an empty batch as good news.
 */
export function readCredentials(settings: Record<string, string | undefined>): R2Credentials {
  const value = (name: string): string => (settings[name] ?? "").trim();
  const missing = REQUIRED.filter((name) => value(name) === "");

  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.join(", ")}.\n\n` +
        "The pull reads the bucket with the scoped read-only R2 API token from\n" +
        "issue #114, Step 8 — the account login has no R2 scope and cannot do it.\n" +
        "All three values are on that token's page in the Cloudflare dashboard\n" +
        "(R2 -> API -> Manage API tokens): the account id, the Access Key ID and\n" +
        "the Secret Access Key.\n\n" +
        "Put them in `credentials.env` at the repository root, one per line:\n\n" +
        "    R2_ACCOUNT_ID=...\n" +
        "    R2_ACCESS_KEY_ID=...\n" +
        "    R2_SECRET_ACCESS_KEY=...\n\n" +
        "That file is git-ignored and must stay that way. Exported environment\n" +
        "variables of the same names work too, and win over the file.",
    );
  }

  const accountId = value("R2_ACCOUNT_ID");
  const bucket = value("R2_BUCKET") || APPEAL_BUCKET;

  for (const [name, setting] of [
    ["R2_ACCOUNT_ID", accountId],
    ["R2_BUCKET", bucket],
  ] as const) {
    if (!URL_SAFE.test(setting)) {
      throw new Error(
        `${name} is ${JSON.stringify(setting)}, which is not letters, digits and hyphens.\n` +
          "That value goes into the URL the pull signs and requests, so a stray\n" +
          "punctuation mark in it would address a different host entirely. Check it\n" +
          "against the token's page in the Cloudflare dashboard.",
      );
    }
  }

  return {
    accountId,
    accessKeyId: value("R2_ACCESS_KEY_ID"),
    secretAccessKey: value("R2_SECRET_ACCESS_KEY"),
    bucket,
  };
}

/** One object as it came out of the bucket. */
export interface AppealObject {
  /** The key it was listed under. */
  key: string;
  /** Its body: `serialiseCandidate` output, trailing newline and all. */
  body: string;
}

export interface PullSelection {
  /** The candidates new to the queue, in listing order — chronological. */
  added: SupplementCandidate[];
  /** Precisely what to append: JSON Lines the existing queue reader accepts. */
  append: string;
  /** Keys whose body held no readable candidate. */
  unreadable: string[];
  /** Keys no record in their own body derives — the format drift #120 fears. */
  misfiled: string[];
}

/**
 * Choose what to append. Objects already represented in `held` are passed over,
 * which is what makes a second run a no-op, and duplicates *within* one batch are
 * collapsed the same way.
 *
 * A key that no record in its own body derives is reported rather than dropped.
 * That is the one disagreement between the writing end and this one that would
 * otherwise be silent — if the two ever drift, a pull returns nothing and looks
 * exactly like a quiet day — so it is surfaced, while the record itself is still
 * kept. The record is the report; the key is only where it was filed.
 */
export function selectNewCandidates(
  objects: readonly AppealObject[],
  held: ReadonlySet<string>,
): PullSelection {
  const added: SupplementCandidate[] = [];
  const unreadable: string[] = [];
  const misfiled: string[] = [];
  const seen = new Set(held);

  for (const object of objects) {
    const candidates = parseCandidates(object.body);
    if (candidates.length === 0) {
      unreadable.push(object.key);
      continue;
    }
    if (!candidates.some((candidate) => candidateKey(candidate) === object.key)) {
      misfiled.push(object.key);
    }

    for (const candidate of candidates) {
      const key = candidateKey(candidate);
      if (seen.has(key)) continue;
      seen.add(key);
      added.push(candidate);
    }
  }

  return {
    added,
    append: added.map(serialiseCandidate).join(""),
    unreadable,
    misfiled,
  };
}

/**
 * The object keys a queue's records account for. Feed it the live queue and the
 * archive together: between them they are everything the maintainer has ever
 * pulled, and a key in either is a record not to fetch again.
 */
export function candidateKeysIn(...queues: readonly string[]): Set<string> {
  const keys = new Set<string>();
  for (const queue of queues) {
    for (const candidate of parseCandidates(queue)) keys.add(candidateKey(candidate));
  }
  return keys;
}
