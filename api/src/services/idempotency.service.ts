import crypto from "crypto";
import type { PoolClient } from "pg";
import { HttpError } from "../utils/HttpError";

export function computeRequestHash(
  method: string,
  path: string,
  body: unknown
): string {
  const payload = JSON.stringify({
    method: method.toUpperCase(),
    path,
    body: body ? sortKeys(body) : null,
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function sortKeys(obj: any): any {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  return Object.keys(obj)
    .sort()
    .reduce((sorted: any, key) => {
      sorted[key] = sortKeys(obj[key]);
      return sorted;
    }, {});
}

export interface IdempotencyResult {
  isNew: boolean;
  storedStatus?: number;
  storedBody?: unknown;
}

export async function checkIdempotencyKey(
  client: PoolClient,
  userId: string,
  key: string,
  requestHash: string
): Promise<IdempotencyResult> {
  // Try to insert the key
  const insertResult = await client.query(
    `INSERT INTO idempotency_keys (user_id, key, request_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, key) DO NOTHING
     RETURNING id`,
    [userId, key, requestHash]
  );

  if (insertResult.rows.length > 0) {
    // New key, proceed with operation
    return { isNew: true };
  }

  // Key already exists, check hash
  const existingResult = await client.query(
    `SELECT request_hash, response_status, response_body
     FROM idempotency_keys
     WHERE user_id = $1 AND key = $2`,
    [userId, key]
  );

  const existing = existingResult.rows[0];

  if (existing.request_hash !== requestHash) {
    throw new HttpError(422, "Idempotency key already used with a different request", {
      code: "IDEMPOTENCY_KEY_REUSED",
    });
  }

  // Same request, return stored response if available
  if (existing.response_status !== null) {
    return {
      isNew: false,
      storedStatus: existing.response_status,
      storedBody: existing.response_body,
    };
  }

  // Key exists but no response yet (concurrent request still in progress)
  // The unique constraint blocks until the first transaction completes
  return { isNew: true };
}

export async function saveIdempotencyResponse(
  client: PoolClient,
  userId: string,
  key: string,
  responseStatus: number,
  responseBody: unknown
): Promise<void> {
  await client.query(
    `UPDATE idempotency_keys
     SET response_status = $1, response_body = $2
     WHERE user_id = $3 AND key = $4`,
    [responseStatus, JSON.stringify(responseBody), userId, key]
  );
}
