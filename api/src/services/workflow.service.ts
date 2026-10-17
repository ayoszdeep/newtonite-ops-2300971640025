import type { PoolClient } from "pg";
import { HttpError } from "../utils/HttpError";

const TRANSITIONS: Record<string, string[]> = {
  OPEN: ["IN_PROGRESS"],
  IN_PROGRESS: ["PENDING_APPROVAL", "RESOLVED"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED"],
  APPROVED: ["RESOLVED"],
  REJECTED: ["IN_PROGRESS"],
  RESOLVED: ["CLOSED"],
  CLOSED: [],
};

// These statuses can only be set through the approvals endpoint (bug fix #2)
const APPROVAL_ONLY_TARGETS = new Set(["APPROVED", "REJECTED"]);

export function validateTransition(
  currentStatus: string,
  targetStatus: string,
  requiresApproval: boolean,
  assigneeId: string | null,
  isApprovalEndpoint: boolean = false
): void {
  const allowed = TRANSITIONS[currentStatus];

  if (!allowed) {
    throw new HttpError(422, `Unknown current status: ${currentStatus}`, {
      code: "INVALID_TRANSITION",
    });
  }

  if (!allowed.includes(targetStatus)) {
    throw new HttpError(422, `Cannot transition from ${currentStatus} to ${targetStatus}`, {
      code: "INVALID_TRANSITION",
      currentStatus,
      targetStatus,
      allowedTransitions: allowed,
    });
  }

  // Only the approval endpoint may set APPROVED or REJECTED (bug fix #2)
  if (APPROVAL_ONLY_TARGETS.has(targetStatus) && !isApprovalEndpoint) {
    throw new HttpError(403, "Use the approvals endpoint for approval/rejection", {
      code: "APPROVAL_REQUIRED",
    });
  }

  // If requires_approval, cannot go directly IN_PROGRESS -> RESOLVED
  if (requiresApproval && currentStatus === "IN_PROGRESS" && targetStatus === "RESOLVED") {
    throw new HttpError(422, "This item requires approval before it can be resolved", {
      code: "INVALID_TRANSITION",
      reason: "requires_approval",
    });
  }

  // IN_PROGRESS requires an assignee (design #11)
  if (targetStatus === "IN_PROGRESS" && !assigneeId) {
    throw new HttpError(422, "Item must have an assignee before moving to IN_PROGRESS", {
      code: "INVALID_TRANSITION",
      reason: "assignee_required",
    });
  }
}

export async function transitionItem(
  client: PoolClient,
  itemId: string,
  targetStatus: string,
  expectedVersion: number,
  actorId: string
): Promise<any> {
  // Lock the row and get current state
  const lockResult = await client.query(
    "SELECT * FROM work_items WHERE id = $1 FOR UPDATE",
    [itemId]
  );

  if (lockResult.rows.length === 0) {
    throw new HttpError(404, "Work item not found");
  }

  const item = lockResult.rows[0];

  if (item.version !== expectedVersion) {
    throw new HttpError(409, "Item was modified by another user", {
      code: "VERSION_CONFLICT",
      current: item,
    });
  }

  validateTransition(
    item.status,
    targetStatus,
    item.requires_approval,
    item.assignee_id
  );

  // Perform the update
  const updateResult = await client.query(
    `UPDATE work_items
     SET status = $1, version = version + 1, updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [targetStatus, itemId]
  );

  const updated = updateResult.rows[0];

  // Record activity
  await client.query(
    `INSERT INTO activity_events (item_id, actor_id, event_type, before_data, after_data)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      itemId,
      actorId,
      "STATUS_CHANGED",
      JSON.stringify({ status: item.status }),
      JSON.stringify({ status: targetStatus }),
    ]
  );

  // Create outbox event
  await client.query(
    `INSERT INTO outbox_events (event_type, payload)
     VALUES ($1, $2)`,
    [
      "ITEM_STATUS_CHANGED",
      JSON.stringify({
        itemId,
        actorId,
        teamId: item.team_id,
        fromStatus: item.status,
        toStatus: targetStatus,
        assigneeId: item.assignee_id,
        createdBy: item.created_by,
      }),
    ]
  );

  // If transitioning to PENDING_APPROVAL, create an approval record
  if (targetStatus === "PENDING_APPROVAL") {
    await client.query(
      `INSERT INTO approvals (item_id, requested_by)
       VALUES ($1, $2)`,
      [itemId, actorId]
    );
  }

  return updated;
}

export function getAllowedTransitions(status: string): string[] {
  return TRANSITIONS[status] ?? [];
}
