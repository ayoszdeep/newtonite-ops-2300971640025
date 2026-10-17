import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "../db/pool";
import { HttpError } from "../utils/HttpError";
import { withTransaction } from "../db/transaction";
import { recordEvent } from "./audit.service";
import { enqueueEvent } from "./outbox.service";
import {
  checkIdempotencyKey,
  computeRequestHash,
  saveIdempotencyResponse,
} from "./idempotency.service";
import { checkItemTeamAccess } from "../middleware/authorizeTeam";

// Validation schemas
export const createItemSchema = z.object({
  teamId: z.string().uuid(),
  type: z.enum(["incident", "payment", "compliance", "task"]),
  title: z.string().min(1).max(500),
  description: z.string().max(10000).default(""),
  priority: z.enum(["P0", "P1", "P2", "P3"]).default("P2"),
  requiresApproval: z.boolean().default(false),
  dueAt: z.string().datetime().nullable().optional(),
});

export const updateItemSchema = z.object({
  expectedVersion: z.number().int().positive(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10000).optional(),
  priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
  requiresApproval: z.boolean().optional(),
  dueAt: z.string().datetime().nullable().optional(),
});

export const transitionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  status: z.enum([
    "OPEN", "IN_PROGRESS", "PENDING_APPROVAL",
    "APPROVED", "REJECTED", "RESOLVED", "CLOSED",
  ]),
});

export const commentSchema = z.object({
  body: z.string().min(1).max(10000),
});

export const assignSchema = z.object({
  assigneeId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
});

// ---- Create Item ----
export async function createItem(
  userId: string,
  data: z.infer<typeof createItemSchema>,
  idempotencyKey: string,
  method: string,
  path: string,
  body: unknown
) {
  const requestHash = computeRequestHash(method, path, body);

  return withTransaction(async (client) => {
    // Check idempotency
    const idempResult = await checkIdempotencyKey(client, userId, idempotencyKey, requestHash);

    if (!idempResult.isNew && idempResult.storedStatus !== undefined) {
      return { status: idempResult.storedStatus, body: idempResult.storedBody };
    }

    // Check team membership
    const membership = await client.query(
      "SELECT role FROM team_memberships WHERE user_id = $1 AND team_id = $2",
      [userId, data.teamId]
    );

    if (membership.rows.length === 0) {
      throw new HttpError(404, "Resource not found");
    }

    const role = membership.rows[0].role;
    if (role === "viewer") {
      throw new HttpError(403, "Insufficient permissions to create items");
    }

    // Insert work item
    const itemResult = await client.query(
      `INSERT INTO work_items (team_id, type, title, description, priority, requires_approval, due_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        data.teamId,
        data.type,
        data.title,
        data.description,
        data.priority,
        data.requiresApproval,
        data.dueAt ?? null,
        userId,
      ]
    );

    const item = itemResult.rows[0];

    // Record activity event
    await recordEvent(client, {
      itemId: item.id,
      actorId: userId,
      eventType: "ITEM_CREATED",
      beforeData: null,
      afterData: {
        type: item.type,
        title: item.title,
        priority: item.priority,
        status: item.status,
        requiresApproval: item.requires_approval,
      },
    });

    // Outbox event
    await enqueueEvent(client, {
      eventType: "ITEM_CREATED",
      payload: {
        itemId: item.id,
        actorId: userId,
        teamId: data.teamId,
        title: item.title,
        type: item.type,
        priority: item.priority,
      },
    });

    const responseBody = { item };

    // Save idempotency response
    await saveIdempotencyResponse(client, userId, idempotencyKey, 201, responseBody);

    return { status: 201, body: responseBody };
  });
}

// ---- Get Single Item ----
export async function getItem(userId: string, itemId: string) {
  const itemResult = await pool.query(
    `SELECT wi.*,
            u_creator.name as created_by_name,
            u_assignee.name as assignee_name,
            t.name as team_name, t.slug as team_slug
     FROM work_items wi
     JOIN users u_creator ON u_creator.id = wi.created_by
     LEFT JOIN users u_assignee ON u_assignee.id = wi.assignee_id
     JOIN teams t ON t.id = wi.team_id
     WHERE wi.id = $1`,
    [itemId]
  );

  if (itemResult.rows.length === 0) {
    throw new HttpError(404, "Work item not found");
  }

  const item = itemResult.rows[0];

  // Check team access
  const access = await checkItemTeamAccess(userId, item.team_id, "view");
  if (!access) {
    throw new HttpError(404, "Work item not found");
  }

  // Compute permissions (design #14)
  const permissions = {
    canEdit: access.role === "member" || access.role === "lead",
    canClaim: (access.role === "member" || access.role === "lead") &&
      !item.assignee_id &&
      !['RESOLVED', 'CLOSED'].includes(item.status),
    canTransition: access.role === "member" || access.role === "lead",
    canApprove: access.role === "lead" && item.status === "PENDING_APPROVAL",
    canComment: access.role === "member" || access.role === "lead",
    canAssign: access.role === "member" || access.role === "lead",
    canUnassign: access.role === "lead" ||
      (item.assignee_id === userId && (access.role === "member" || access.role === "lead")),
  };

  return {
    item: {
      ...item,
      search_vector: undefined, // Don't expose internal field
    },
    permissions,
  };
}

// ---- List Items ----
export async function listItems(
  userId: string,
  filters: {
    teamId?: string;
    status?: string;
    priority?: string;
    assigneeId?: string;
    type?: string;
    search?: string;
    limit?: number;
    cursor?: string;
  }
) {
  // Get user's teams
  const teamsResult = await pool.query(
    "SELECT team_id FROM team_memberships WHERE user_id = $1",
    [userId]
  );

  if (teamsResult.rows.length === 0) {
    return { items: [], nextCursor: null };
  }

  const userTeamIds = teamsResult.rows.map((r: any) => r.team_id);
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);

  const conditions: string[] = ["wi.team_id = ANY($1)"];
  const params: unknown[] = [userTeamIds];
  let paramIndex = 2;

  if (filters.teamId) {
    if (!userTeamIds.includes(filters.teamId)) {
      return { items: [], nextCursor: null };
    }
    conditions.push(`wi.team_id = $${paramIndex}`);
    params.push(filters.teamId);
    paramIndex++;
  }

  if (filters.status) {
    conditions.push(`wi.status = $${paramIndex}`);
    params.push(filters.status);
    paramIndex++;
  }

  if (filters.priority) {
    conditions.push(`wi.priority = $${paramIndex}`);
    params.push(filters.priority);
    paramIndex++;
  }

  if (filters.assigneeId) {
    conditions.push(`wi.assignee_id = $${paramIndex}`);
    params.push(filters.assigneeId);
    paramIndex++;
  }

  if (filters.type) {
    conditions.push(`wi.type = $${paramIndex}`);
    params.push(filters.type);
    paramIndex++;
  }

  if (filters.search) {
    conditions.push(`wi.search_vector @@ plainto_tsquery('english', $${paramIndex})`);
    params.push(filters.search);
    paramIndex++;
  }

  // Cursor-based pagination
  if (filters.cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(filters.cursor, "base64").toString("utf-8"));
      conditions.push(`(wi.updated_at, wi.id) < ($${paramIndex}, $${paramIndex + 1})`);
      params.push(decoded.updatedAt, decoded.id);
      paramIndex += 2;
    } catch {
      throw new HttpError(400, "Invalid cursor");
    }
  }

  params.push(limit);

  const sql = `
    SELECT wi.*,
           u_creator.name as created_by_name,
           u_assignee.name as assignee_name,
           t.name as team_name
    FROM work_items wi
    JOIN users u_creator ON u_creator.id = wi.created_by
    LEFT JOIN users u_assignee ON u_assignee.id = wi.assignee_id
    JOIN teams t ON t.id = wi.team_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY wi.updated_at DESC, wi.id DESC
    LIMIT $${paramIndex}
  `;

  const result = await pool.query(sql, params);
  const items = result.rows.map((row: any) => ({
    ...row,
    search_vector: undefined,
  }));

  let nextCursor: string | null = null;
  if (items.length === limit) {
    const last = items[items.length - 1];
    nextCursor = Buffer.from(
      JSON.stringify({ updatedAt: last.updated_at, id: last.id })
    ).toString("base64");
  }

  return { items, nextCursor };
}

// ---- Update Item ----
export async function updateItem(
  userId: string,
  itemId: string,
  data: z.infer<typeof updateItemSchema>
) {
  return withTransaction(async (client) => {
    // Lock row and fetch current state
    const lockResult = await client.query(
      "SELECT * FROM work_items WHERE id = $1 FOR UPDATE",
      [itemId]
    );

    if (lockResult.rows.length === 0) {
      throw new HttpError(404, "Work item not found");
    }

    const item = lockResult.rows[0];

    // Check team access
    const membership = await client.query(
      "SELECT role FROM team_memberships WHERE user_id = $1 AND team_id = $2",
      [userId, item.team_id]
    );

    if (membership.rows.length === 0) {
      throw new HttpError(404, "Work item not found");
    }

    const role = membership.rows[0].role;
    if (role === "viewer") {
      throw new HttpError(403, "Insufficient permissions");
    }

    // Version check
    if (item.version !== data.expectedVersion) {
      throw new HttpError(409, "Item was modified by another user", {
        code: "VERSION_CONFLICT",
        current: item,
      });
    }

    // Build update fields
    const updates: string[] = [];
    const values: unknown[] = [];
    const beforeData: Record<string, unknown> = {};
    const afterData: Record<string, unknown> = {};
    let vi = 1;

    const editableFields: Array<{ key: keyof typeof data; column: string }> = [
      { key: "title", column: "title" },
      { key: "description", column: "description" },
      { key: "priority", column: "priority" },
      { key: "requiresApproval", column: "requires_approval" },
      { key: "dueAt", column: "due_at" },
    ];

    for (const field of editableFields) {
      if (data[field.key] !== undefined) {
        updates.push(`${field.column} = $${vi}`);
        values.push(data[field.key]);
        beforeData[field.column] = item[field.column];
        afterData[field.column] = data[field.key];
        vi++;
      }
    }

    if (updates.length === 0) {
      throw new HttpError(400, "No fields to update");
    }

    updates.push(`version = version + 1`);
    updates.push(`updated_at = NOW()`);

    values.push(itemId);

    const updateResult = await client.query(
      `UPDATE work_items SET ${updates.join(", ")} WHERE id = $${vi} RETURNING *`,
      values
    );

    const updated = updateResult.rows[0];

    // Determine event type from what changed
    let eventType = "ITEM_UPDATED";
    if (afterData.priority && !afterData.title && !afterData.description) {
      eventType = "PRIORITY_CHANGED";
    }

    await recordEvent(client, {
      itemId,
      actorId: userId,
      eventType,
      beforeData,
      afterData,
    });

    await enqueueEvent(client, {
      eventType: "ITEM_UPDATED",
      payload: {
        itemId,
        actorId: userId,
        teamId: item.team_id,
        assigneeId: item.assignee_id,
        createdBy: item.created_by,
        changes: afterData,
      },
    });

    return updated;
  });
}

// ---- Claim Item ----
export async function claimItem(userId: string, itemId: string) {
  return withTransaction(async (client) => {
    // Lock and fetch
    const lockResult = await client.query(
      "SELECT * FROM work_items WHERE id = $1 FOR UPDATE",
      [itemId]
    );

    if (lockResult.rows.length === 0) {
      throw new HttpError(404, "Work item not found");
    }

    const item = lockResult.rows[0];

    // Check team membership
    const membership = await client.query(
      "SELECT role FROM team_memberships WHERE user_id = $1 AND team_id = $2",
      [userId, item.team_id]
    );

    if (membership.rows.length === 0) {
      throw new HttpError(404, "Work item not found");
    }

    const role = membership.rows[0].role;
    if (role === "viewer") {
      throw new HttpError(403, "Insufficient permissions");
    }

    // Already claimed by same user - idempotent (design #10)
    if (item.assignee_id === userId) {
      return item;
    }

    // Already claimed by someone else
    if (item.assignee_id !== null) {
      throw new HttpError(409, "Item is already claimed", {
        code: "ALREADY_CLAIMED",
        current: item,
      });
    }

    // Can't claim resolved/closed items
    if (["RESOLVED", "CLOSED"].includes(item.status)) {
      throw new HttpError(409, "Cannot claim a resolved or closed item", {
        code: "ALREADY_CLAIMED",
        current: item,
      });
    }

    // Use conditional UPDATE for race safety
    const updateResult = await client.query(
      `UPDATE work_items
       SET assignee_id = $1, version = version + 1, updated_at = NOW()
       WHERE id = $2 AND assignee_id IS NULL AND status NOT IN ('RESOLVED', 'CLOSED')
       RETURNING *`,
      [userId, itemId]
    );

    if (updateResult.rows.length === 0) {
      // Race condition: someone else claimed it between our SELECT and UPDATE
      const refetch = await client.query("SELECT * FROM work_items WHERE id = $1", [itemId]);
      throw new HttpError(409, "Item was claimed by another user", {
        code: "ALREADY_CLAIMED",
        current: refetch.rows[0],
      });
    }

    const updated = updateResult.rows[0];

    await recordEvent(client, {
      itemId,
      actorId: userId,
      eventType: "ITEM_CLAIMED",
      beforeData: { assignee_id: null },
      afterData: { assignee_id: userId },
    });

    await enqueueEvent(client, {
      eventType: "ITEM_CLAIMED",
      payload: {
        itemId,
        actorId: userId,
        teamId: item.team_id,
        createdBy: item.created_by,
      },
    });

    return updated;
  });
}

// ---- Assign Item ----
export async function assignItem(
  userId: string,
  itemId: string,
  assigneeId: string,
  expectedVersion: number
) {
  return withTransaction(async (client) => {
    const lockResult = await client.query(
      "SELECT * FROM work_items WHERE id = $1 FOR UPDATE",
      [itemId]
    );

    if (lockResult.rows.length === 0) {
      throw new HttpError(404, "Work item not found");
    }

    const item = lockResult.rows[0];

    // Check caller's team membership
    const callerMembership = await client.query(
      "SELECT role FROM team_memberships WHERE user_id = $1 AND team_id = $2",
      [userId, item.team_id]
    );

    if (callerMembership.rows.length === 0) {
      throw new HttpError(404, "Work item not found");
    }

    const callerRole = callerMembership.rows[0].role;
    if (callerRole === "viewer") {
      throw new HttpError(403, "Insufficient permissions");
    }

    // Check assignee's team membership
    const assigneeMembership = await client.query(
      "SELECT role FROM team_memberships WHERE user_id = $1 AND team_id = $2",
      [assigneeId, item.team_id]
    );

    if (assigneeMembership.rows.length === 0) {
      throw new HttpError(422, "Assignee is not a member of this team");
    }

    // Version check
    if (item.version !== expectedVersion) {
      throw new HttpError(409, "Item was modified by another user", {
        code: "VERSION_CONFLICT",
        current: item,
      });
    }

    const updateResult = await client.query(
      `UPDATE work_items
       SET assignee_id = $1, version = version + 1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [assigneeId, itemId]
    );

    const updated = updateResult.rows[0];

    await recordEvent(client, {
      itemId,
      actorId: userId,
      eventType: "ITEM_ASSIGNED",
      beforeData: { assignee_id: item.assignee_id },
      afterData: { assignee_id: assigneeId },
    });

    await enqueueEvent(client, {
      eventType: "ITEM_ASSIGNED",
      payload: {
        itemId,
        actorId: userId,
        teamId: item.team_id,
        assigneeId,
        previousAssigneeId: item.assignee_id,
        createdBy: item.created_by,
      },
    });

    return updated;
  });
}

// ---- Unassign Item (design #11) ----
export async function unassignItem(
  userId: string,
  itemId: string,
  expectedVersion: number
) {
  return withTransaction(async (client) => {
    const lockResult = await client.query(
      "SELECT * FROM work_items WHERE id = $1 FOR UPDATE",
      [itemId]
    );

    if (lockResult.rows.length === 0) {
      throw new HttpError(404, "Work item not found");
    }

    const item = lockResult.rows[0];

    const membership = await client.query(
      "SELECT role FROM team_memberships WHERE user_id = $1 AND team_id = $2",
      [userId, item.team_id]
    );

    if (membership.rows.length === 0) {
      throw new HttpError(404, "Work item not found");
    }

    const role = membership.rows[0].role;

    // Only the assignee themselves or a lead can unassign
    if (item.assignee_id !== userId && role !== "lead") {
      throw new HttpError(403, "Only the assignee or a team lead can unassign");
    }

    if (!item.assignee_id) {
      throw new HttpError(400, "Item is not assigned");
    }

    if (item.version !== expectedVersion) {
      throw new HttpError(409, "Item was modified by another user", {
        code: "VERSION_CONFLICT",
        current: item,
      });
    }

    const updateResult = await client.query(
      `UPDATE work_items
       SET assignee_id = NULL, version = version + 1, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [itemId]
    );

    const updated = updateResult.rows[0];

    await recordEvent(client, {
      itemId,
      actorId: userId,
      eventType: "ITEM_UNASSIGNED",
      beforeData: { assignee_id: item.assignee_id },
      afterData: { assignee_id: null },
    });

    await enqueueEvent(client, {
      eventType: "ITEM_UNASSIGNED",
      payload: {
        itemId,
        actorId: userId,
        teamId: item.team_id,
        previousAssigneeId: item.assignee_id,
        createdBy: item.created_by,
      },
    });

    return updated;
  });
}

// ---- Add Comment ----
export async function addComment(
  userId: string,
  itemId: string,
  body: string,
  idempotencyKey: string,
  method: string,
  path: string,
  requestBody: unknown
) {
  const requestHash = computeRequestHash(method, path, requestBody);

  return withTransaction(async (client) => {
    const idempResult = await checkIdempotencyKey(client, userId, idempotencyKey, requestHash);

    if (!idempResult.isNew && idempResult.storedStatus !== undefined) {
      return { status: idempResult.storedStatus, body: idempResult.storedBody };
    }

    // Check item exists and user has access
    const itemResult = await client.query(
      "SELECT id, team_id FROM work_items WHERE id = $1",
      [itemId]
    );

    if (itemResult.rows.length === 0) {
      throw new HttpError(404, "Work item not found");
    }

    const item = itemResult.rows[0];

    const membership = await client.query(
      "SELECT role FROM team_memberships WHERE user_id = $1 AND team_id = $2",
      [userId, item.team_id]
    );

    if (membership.rows.length === 0) {
      throw new HttpError(404, "Work item not found");
    }

    const role = membership.rows[0].role;
    if (role === "viewer") {
      throw new HttpError(403, "Insufficient permissions to comment");
    }

    // Comments do NOT bump item version (design #11)
    const commentResult = await client.query(
      `INSERT INTO comments (item_id, user_id, body)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [itemId, userId, body.trim()]
    );

    const comment = commentResult.rows[0];

    await recordEvent(client, {
      itemId,
      actorId: userId,
      eventType: "COMMENT_ADDED",
      beforeData: null,
      afterData: { commentId: comment.id, bodyPreview: body.trim().slice(0, 100) },
    });

    await enqueueEvent(client, {
      eventType: "COMMENT_ADDED",
      payload: {
        itemId,
        actorId: userId,
        teamId: item.team_id,
        commentId: comment.id,
      },
    });

    const responseBody = { comment };
    await saveIdempotencyResponse(client, userId, idempotencyKey, 201, responseBody);

    return { status: 201, body: responseBody };
  });
}

// ---- List Comments ----
export async function listComments(
  userId: string,
  itemId: string,
  limit: number = 50,
  cursor?: string
) {
  // Check item and access
  const itemResult = await pool.query(
    "SELECT id, team_id FROM work_items WHERE id = $1",
    [itemId]
  );

  if (itemResult.rows.length === 0) {
    throw new HttpError(404, "Work item not found");
  }

  const item = itemResult.rows[0];
  const access = await checkItemTeamAccess(userId, item.team_id, "view");
  if (!access) {
    throw new HttpError(404, "Work item not found");
  }

  const params: unknown[] = [itemId, Math.min(Math.max(limit, 1), 100)];
  let cursorClause = "";

  if (cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(cursor, "base64").toString("utf-8"));
      cursorClause = "AND (c.created_at, c.id) < ($3, $4)";
      params.push(decoded.createdAt, decoded.id);
    } catch {
      throw new HttpError(400, "Invalid cursor");
    }
  }

  const result = await pool.query(
    `SELECT c.*, u.name as user_name, u.email as user_email
     FROM comments c
     JOIN users u ON u.id = c.user_id
     WHERE c.item_id = $1
     ${cursorClause}
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT $2`,
    params
  );

  const comments = result.rows;
  let nextCursor: string | null = null;

  if (comments.length === limit) {
    const last = comments[comments.length - 1];
    nextCursor = Buffer.from(
      JSON.stringify({ createdAt: last.created_at, id: last.id })
    ).toString("base64");
  }

  return { comments, nextCursor };
}

// ---- Transition Item (via workflow service) ----
export async function transitionItem(
  userId: string,
  itemId: string,
  targetStatus: string,
  expectedVersion: number,
  idempotencyKey: string,
  method: string,
  path: string,
  requestBody: unknown
) {
  const { transitionItem: doTransition } = await import("./workflow.service");
  const requestHash = computeRequestHash(method, path, requestBody);

  return withTransaction(async (client) => {
    const idempResult = await checkIdempotencyKey(client, userId, idempotencyKey, requestHash);

    if (!idempResult.isNew && idempResult.storedStatus !== undefined) {
      return { status: idempResult.storedStatus, body: idempResult.storedBody };
    }

    // Check access
    const itemResult = await client.query(
      "SELECT team_id FROM work_items WHERE id = $1",
      [itemId]
    );

    if (itemResult.rows.length === 0) {
      throw new HttpError(404, "Work item not found");
    }

    const membership = await client.query(
      "SELECT role FROM team_memberships WHERE user_id = $1 AND team_id = $2",
      [userId, itemResult.rows[0].team_id]
    );

    if (membership.rows.length === 0) {
      throw new HttpError(404, "Work item not found");
    }

    if (membership.rows[0].role === "viewer") {
      throw new HttpError(403, "Insufficient permissions");
    }

    const updatedItem = await doTransition(client, itemId, targetStatus, expectedVersion, userId);

    const responseBody = { item: updatedItem };
    await saveIdempotencyResponse(client, userId, idempotencyKey, 200, responseBody);

    return { status: 200, body: responseBody };
  });
}
