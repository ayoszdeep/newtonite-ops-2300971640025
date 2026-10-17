import type { PoolClient } from "pg";
import { pool } from "../db/pool";
import { HttpError } from "../utils/HttpError";
import { withTransaction } from "../db/transaction";
import { validateTransition } from "./workflow.service";
import { recordEvent } from "./audit.service";
import { enqueueEvent } from "./outbox.service";

export async function getPendingApprovals(userId: string) {
  // Get teams where user is a lead
  const teamsResult = await pool.query(
    `SELECT team_id FROM team_memberships WHERE user_id = $1 AND role = 'lead'`,
    [userId]
  );

  if (teamsResult.rows.length === 0) {
    return [];
  }

  const teamIds = teamsResult.rows.map((r: any) => r.team_id);

  const result = await pool.query(
    `SELECT a.*, wi.title as item_title, wi.type as item_type,
            wi.priority as item_priority, wi.team_id, wi.version as item_version,
            wi.assignee_id, wi.created_by as item_created_by,
            u_req.name as requested_by_name, u_req.email as requested_by_email,
            t.name as team_name
     FROM approvals a
     JOIN work_items wi ON wi.id = a.item_id
     JOIN users u_req ON u_req.id = a.requested_by
     JOIN teams t ON t.id = wi.team_id
     WHERE a.decision = 'PENDING'
       AND wi.team_id = ANY($1)
     ORDER BY a.requested_at DESC`,
    [teamIds]
  );

  return result.rows;
}

export async function approveItem(
  approvalId: string,
  actorId: string,
  expectedVersion: number
) {
  return withTransaction(async (client) => {
    // Lock the approval record
    const approvalResult = await client.query(
      "SELECT * FROM approvals WHERE id = $1 FOR UPDATE",
      [approvalId]
    );

    if (approvalResult.rows.length === 0) {
      throw new HttpError(404, "Approval not found");
    }

    const approval = approvalResult.rows[0];

    if (approval.decision !== "PENDING") {
      throw new HttpError(409, "Approval has already been decided", {
        code: "ALREADY_DECIDED",
        decision: approval.decision,
      });
    }

    // Self-approval check
    if (approval.requested_by === actorId) {
      throw new HttpError(403, "Cannot approve your own request", {
        code: "SELF_APPROVAL",
      });
    }

    // Lock the work item
    const itemResult = await client.query(
      "SELECT * FROM work_items WHERE id = $1 FOR UPDATE",
      [approval.item_id]
    );

    if (itemResult.rows.length === 0) {
      throw new HttpError(404, "Work item not found");
    }

    const item = itemResult.rows[0];

    // Verify lead membership
    const membershipResult = await client.query(
      "SELECT role FROM team_memberships WHERE user_id = $1 AND team_id = $2",
      [actorId, item.team_id]
    );

    if (membershipResult.rows.length === 0 || membershipResult.rows[0].role !== "lead") {
      throw new HttpError(403, "Only team leads can approve requests");
    }

    // Version check
    if (item.version !== expectedVersion) {
      throw new HttpError(409, "Item was modified by another user", {
        code: "VERSION_CONFLICT",
        current: item,
      });
    }

    // Validate the transition
    if (item.status !== "PENDING_APPROVAL") {
      throw new HttpError(422, "Item is not pending approval", {
        code: "INVALID_TRANSITION",
        currentStatus: item.status,
      });
    }

    // Update approval
    await client.query(
      `UPDATE approvals
       SET decision = 'APPROVED', decided_by = $1, decided_at = NOW(), reason = $2
       WHERE id = $3`,
      [actorId, null, approvalId]
    );

    // Update item status to APPROVED
    const updatedItemResult = await client.query(
      `UPDATE work_items
       SET status = 'APPROVED', version = version + 1, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [approval.item_id]
    );

    const updatedItem = updatedItemResult.rows[0];

    // Record activity
    await recordEvent(client, {
      itemId: approval.item_id,
      actorId,
      eventType: "APPROVAL_APPROVED",
      beforeData: { status: "PENDING_APPROVAL", decision: "PENDING" },
      afterData: { status: "APPROVED", decision: "APPROVED" },
    });

    // Outbox event
    await enqueueEvent(client, {
      eventType: "ITEM_APPROVED",
      payload: {
        itemId: approval.item_id,
        actorId,
        teamId: item.team_id,
        assigneeId: item.assignee_id,
        createdBy: item.created_by,
        requestedBy: approval.requested_by,
      },
    });

    return updatedItem;
  });
}

export async function rejectItem(
  approvalId: string,
  actorId: string,
  expectedVersion: number,
  reason: string
) {
  if (!reason || reason.trim().length === 0) {
    throw new HttpError(400, "Rejection reason is required");
  }

  return withTransaction(async (client) => {
    // Lock the approval record
    const approvalResult = await client.query(
      "SELECT * FROM approvals WHERE id = $1 FOR UPDATE",
      [approvalId]
    );

    if (approvalResult.rows.length === 0) {
      throw new HttpError(404, "Approval not found");
    }

    const approval = approvalResult.rows[0];

    if (approval.decision !== "PENDING") {
      throw new HttpError(409, "Approval has already been decided", {
        code: "ALREADY_DECIDED",
        decision: approval.decision,
      });
    }

    // Self-rejection check
    if (approval.requested_by === actorId) {
      throw new HttpError(403, "Cannot reject your own request", {
        code: "SELF_APPROVAL",
      });
    }

    // Lock the work item
    const itemResult = await client.query(
      "SELECT * FROM work_items WHERE id = $1 FOR UPDATE",
      [approval.item_id]
    );

    if (itemResult.rows.length === 0) {
      throw new HttpError(404, "Work item not found");
    }

    const item = itemResult.rows[0];

    // Verify lead membership
    const membershipResult = await client.query(
      "SELECT role FROM team_memberships WHERE user_id = $1 AND team_id = $2",
      [actorId, item.team_id]
    );

    if (membershipResult.rows.length === 0 || membershipResult.rows[0].role !== "lead") {
      throw new HttpError(403, "Only team leads can reject requests");
    }

    // Version check
    if (item.version !== expectedVersion) {
      throw new HttpError(409, "Item was modified by another user", {
        code: "VERSION_CONFLICT",
        current: item,
      });
    }

    if (item.status !== "PENDING_APPROVAL") {
      throw new HttpError(422, "Item is not pending approval", {
        code: "INVALID_TRANSITION",
        currentStatus: item.status,
      });
    }

    // Update approval
    await client.query(
      `UPDATE approvals
       SET decision = 'REJECTED', decided_by = $1, decided_at = NOW(), reason = $2
       WHERE id = $3`,
      [actorId, reason.trim(), approvalId]
    );

    // Update item status to REJECTED
    const updatedItemResult = await client.query(
      `UPDATE work_items
       SET status = 'REJECTED', version = version + 1, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [approval.item_id]
    );

    const updatedItem = updatedItemResult.rows[0];

    // Record activity
    await recordEvent(client, {
      itemId: approval.item_id,
      actorId,
      eventType: "APPROVAL_REJECTED",
      beforeData: { status: "PENDING_APPROVAL", decision: "PENDING" },
      afterData: { status: "REJECTED", decision: "REJECTED", reason: reason.trim() },
    });

    // Outbox event
    await enqueueEvent(client, {
      eventType: "ITEM_REJECTED",
      payload: {
        itemId: approval.item_id,
        actorId,
        teamId: item.team_id,
        assigneeId: item.assignee_id,
        createdBy: item.created_by,
        requestedBy: approval.requested_by,
        reason: reason.trim(),
      },
    });

    return updatedItem;
  });
}
