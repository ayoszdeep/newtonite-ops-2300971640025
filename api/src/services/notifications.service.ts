import type { PoolClient } from "pg";
import { pool } from "../db/pool";
import { HttpError } from "../utils/HttpError";

export async function createNotification(
  client: PoolClient,
  eventId: string,
  userId: string,
  title: string,
  message: string,
  itemId?: string
): Promise<void> {
  await client.query(
    `INSERT INTO notifications (event_id, user_id, title, message, item_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (event_id, user_id) DO NOTHING`,
    [eventId, userId, title, message, itemId ?? null]
  );
}

export async function getUserNotifications(
  userId: string,
  limit: number = 50,
  cursor?: { createdAt: string; id: string }
) {
  const params: unknown[] = [userId, limit];
  let cursorClause = "";

  if (cursor) {
    cursorClause = "AND (n.created_at, n.id) < ($3, $4)";
    params.push(cursor.createdAt, cursor.id);
  }

  const result = await pool.query(
    `SELECT n.*
     FROM notifications n
     WHERE n.user_id = $1
     ${cursorClause}
     ORDER BY n.created_at DESC, n.id DESC
     LIMIT $2`,
    params
  );

  const notifications = result.rows;
  let nextCursor: string | null = null;

  if (notifications.length === limit) {
    const last = notifications[notifications.length - 1];
    nextCursor = Buffer.from(
      JSON.stringify({ createdAt: last.created_at, id: last.id })
    ).toString("base64");
  }

  // Unread count
  const countResult = await pool.query(
    "SELECT COUNT(*) as unread_count FROM notifications WHERE user_id = $1 AND read_at IS NULL",
    [userId]
  );

  return {
    notifications,
    nextCursor,
    unreadCount: parseInt(countResult.rows[0].unread_count, 10),
  };
}

export async function markRead(userId: string, notificationId: string): Promise<void> {
  const result = await pool.query(
    `UPDATE notifications SET read_at = NOW()
     WHERE id = $1 AND user_id = $2 AND read_at IS NULL`,
    [notificationId, userId]
  );

  if ((result.rowCount ?? 0) === 0) {
    // Check if it exists at all
    const check = await pool.query(
      "SELECT id FROM notifications WHERE id = $1 AND user_id = $2",
      [notificationId, userId]
    );
    if (check.rows.length === 0) {
      throw new HttpError(404, "Notification not found");
    }
    // Already read, idempotent
  }
}

export async function markAllRead(userId: string): Promise<number> {
  const result = await pool.query(
    "UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL",
    [userId]
  );
  return result.rowCount ?? 0;
}
