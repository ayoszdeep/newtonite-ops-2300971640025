import type { PoolClient } from "pg";
import { pool } from "../db/pool";

export interface OutboxEvent {
  eventType: string;
  payload: Record<string, unknown>;
}

export async function enqueueEvent(
  client: PoolClient,
  event: OutboxEvent
): Promise<string> {
  const result = await client.query(
    `INSERT INTO outbox_events (event_type, payload)
     VALUES ($1, $2)
     RETURNING id`,
    [event.eventType, JSON.stringify(event.payload)]
  );
  return result.rows[0].id;
}

export async function claimBatch(batchSize: number): Promise<any[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Select available events with row-level locking, skipping locked rows
    const selectResult = await client.query(
      `SELECT id
       FROM outbox_events
       WHERE status = 'PENDING'
         AND available_at <= NOW()
       ORDER BY available_at, created_at
       FOR UPDATE SKIP LOCKED
       LIMIT $1`,
      [batchSize]
    );

    if (selectResult.rows.length === 0) {
      await client.query("COMMIT");
      return [];
    }

    const ids = selectResult.rows.map((r: any) => r.id);

    // Mark them as PROCESSING
    const updateResult = await client.query(
      `UPDATE outbox_events
       SET status = 'PROCESSING',
           locked_at = NOW(),
           attempts = attempts + 1
       WHERE id = ANY($1)
       RETURNING *`,
      [ids]
    );

    await client.query("COMMIT");
    return updateResult.rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function markProcessed(eventId: string, lockedAt: Date): Promise<void> {
  // Conditional update to prevent stale worker from overwriting (design #12)
  await pool.query(
    `UPDATE outbox_events
     SET status = 'PROCESSED', processed_at = NOW()
     WHERE id = $1 AND status = 'PROCESSING' AND locked_at = $2`,
    [eventId, lockedAt]
  );
}

export async function markFailed(
  eventId: string,
  error: string,
  attempt: number,
  maxAttempts: number
): Promise<void> {
  if (attempt >= maxAttempts) {
    await pool.query(
      `UPDATE outbox_events
       SET status = 'DEAD', last_error = $1
       WHERE id = $2`,
      [error, eventId]
    );
  } else {
    // Exponential backoff: 2^attempt seconds
    const delaySeconds = Math.pow(2, attempt);
    await pool.query(
      `UPDATE outbox_events
       SET status = 'PENDING',
           last_error = $1,
           locked_at = NULL,
           available_at = NOW() + ($2 || ' seconds')::interval
       WHERE id = $3`,
      [error, String(delaySeconds), eventId]
    );
  }
}

export async function recoverStaleEvents(staleSeconds: number = 60): Promise<number> {
  const result = await pool.query(
    `UPDATE outbox_events
     SET status = 'PENDING', locked_at = NULL
     WHERE status = 'PROCESSING'
       AND locked_at < NOW() - ($1 || ' seconds')::interval
     RETURNING id`,
    [String(staleSeconds)]
  );
  return result.rowCount ?? 0;
}

export async function cleanExpiredIdempotencyKeys(): Promise<number> {
  const result = await pool.query(
    "DELETE FROM idempotency_keys WHERE expires_at < NOW()"
  );
  return result.rowCount ?? 0;
}
