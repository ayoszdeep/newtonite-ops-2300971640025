import type { PoolClient } from "pg";
import { pool } from "../db/pool";

export interface AuditEvent {
  itemId: string;
  actorId: string;
  eventType: string;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
}

export async function recordEvent(
  client: PoolClient,
  event: AuditEvent
): Promise<void> {
  await client.query(
    `INSERT INTO activity_events (item_id, actor_id, event_type, before_data, after_data)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      event.itemId,
      event.actorId,
      event.eventType,
      event.beforeData ? JSON.stringify(event.beforeData) : null,
      event.afterData ? JSON.stringify(event.afterData) : null,
    ]
  );
}

export async function getItemActivity(
  itemId: string,
  limit: number = 50,
  cursor?: { createdAt: string; id: string }
) {
  const params: unknown[] = [itemId, limit];
  let cursorClause = "";

  if (cursor) {
    cursorClause = "AND (ae.created_at, ae.id) < ($3, $4)";
    params.push(cursor.createdAt, cursor.id);
  }

  const result = await pool.query(
    `SELECT ae.*, u.name as actor_name, u.email as actor_email
     FROM activity_events ae
     JOIN users u ON u.id = ae.actor_id
     WHERE ae.item_id = $1
     ${cursorClause}
     ORDER BY ae.created_at DESC, ae.id DESC
     LIMIT $2`,
    params
  );

  const events = result.rows;
  let nextCursor: string | null = null;

  if (events.length === limit) {
    const last = events[events.length - 1];
    nextCursor = Buffer.from(
      JSON.stringify({ createdAt: last.created_at, id: last.id })
    ).toString("base64");
  }

  return { events, nextCursor };
}
