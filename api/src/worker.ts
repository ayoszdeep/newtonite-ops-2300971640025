import "dotenv/config";
import { pool } from "./db/pool";
import {
  claimBatch,
  markProcessed,
  markFailed,
  recoverStaleEvents,
  cleanExpiredIdempotencyKeys,
} from "./services/outbox.service";
import { createNotification } from "./services/notifications.service";
import { withTransaction } from "./db/transaction";

const BATCH_SIZE = Number(process.env.OUTBOX_BATCH_SIZE ?? 10);
const MAX_ATTEMPTS = Number(process.env.OUTBOX_MAX_ATTEMPTS ?? 5);
const POLL_INTERVAL = Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 1000);

let running = true;

async function processEvent(event: any): Promise<void> {
  const payload = event.payload;
  const eventType = event.event_type;

  // Determine notification recipients
  const recipients = new Set<string>();
  let title = "";
  let message = "";
  const itemId = payload.itemId;

  switch (eventType) {
    case "ITEM_CREATED":
      title = "New work item created";
      message = `"${payload.title}" (${payload.priority}) was created`;
      // Notify team leads
      await addTeamLeads(payload.teamId, payload.actorId, recipients);
      break;

    case "ITEM_CLAIMED":
      title = "Work item claimed";
      message = `An item was claimed`;
      if (payload.createdBy && payload.createdBy !== payload.actorId) {
        recipients.add(payload.createdBy);
      }
      break;

    case "ITEM_ASSIGNED":
      title = "Work item assigned";
      message = `You have been assigned a work item`;
      if (payload.assigneeId && payload.assigneeId !== payload.actorId) {
        recipients.add(payload.assigneeId);
      }
      if (payload.previousAssigneeId && payload.previousAssigneeId !== payload.actorId) {
        recipients.add(payload.previousAssigneeId);
      }
      if (payload.createdBy && payload.createdBy !== payload.actorId) {
        recipients.add(payload.createdBy);
      }
      break;

    case "ITEM_UNASSIGNED":
      title = "Work item unassigned";
      message = `A work item has been unassigned`;
      if (payload.previousAssigneeId && payload.previousAssigneeId !== payload.actorId) {
        recipients.add(payload.previousAssigneeId);
      }
      if (payload.createdBy && payload.createdBy !== payload.actorId) {
        recipients.add(payload.createdBy);
      }
      break;

    case "ITEM_STATUS_CHANGED":
      title = "Work item status changed";
      message = `Status changed from ${payload.fromStatus} to ${payload.toStatus}`;
      if (payload.assigneeId && payload.assigneeId !== payload.actorId) {
        recipients.add(payload.assigneeId);
      }
      if (payload.createdBy && payload.createdBy !== payload.actorId) {
        recipients.add(payload.createdBy);
      }
      // For PENDING_APPROVAL, notify team leads
      if (payload.toStatus === "PENDING_APPROVAL") {
        await addTeamLeads(payload.teamId, payload.actorId, recipients);
      }
      break;

    case "ITEM_UPDATED":
      title = "Work item updated";
      message = `A work item was updated`;
      if (payload.assigneeId && payload.assigneeId !== payload.actorId) {
        recipients.add(payload.assigneeId);
      }
      if (payload.createdBy && payload.createdBy !== payload.actorId) {
        recipients.add(payload.createdBy);
      }
      break;

    case "ITEM_APPROVED":
      title = "Work item approved";
      message = `Your work item has been approved`;
      if (payload.requestedBy) recipients.add(payload.requestedBy);
      if (payload.assigneeId && payload.assigneeId !== payload.actorId) {
        recipients.add(payload.assigneeId);
      }
      if (payload.createdBy && payload.createdBy !== payload.actorId) {
        recipients.add(payload.createdBy);
      }
      break;

    case "ITEM_REJECTED":
      title = "Work item rejected";
      message = `Your work item has been rejected: ${payload.reason || ""}`;
      if (payload.requestedBy) recipients.add(payload.requestedBy);
      if (payload.assigneeId && payload.assigneeId !== payload.actorId) {
        recipients.add(payload.assigneeId);
      }
      if (payload.createdBy && payload.createdBy !== payload.actorId) {
        recipients.add(payload.createdBy);
      }
      break;

    case "COMMENT_ADDED":
      title = "New comment";
      message = `A new comment was added to a work item`;
      // Notify assignee and creator
      const commentItemResult = await pool.query(
        "SELECT assignee_id, created_by FROM work_items WHERE id = $1",
        [itemId]
      );
      if (commentItemResult.rows.length > 0) {
        const wi = commentItemResult.rows[0];
        if (wi.assignee_id && wi.assignee_id !== payload.actorId) {
          recipients.add(wi.assignee_id);
        }
        if (wi.created_by && wi.created_by !== payload.actorId) {
          recipients.add(wi.created_by);
        }
      }
      break;

    default:
      throw new Error(`Unsupported outbox event type: ${eventType}`);
  }

  // Remove the actor from recipients
  recipients.delete(payload.actorId);

  if (recipients.size === 0) return;

  // Create notifications in a transaction
  await withTransaction(async (client) => {
    for (const userId of recipients) {
      await createNotification(client, event.id, userId, title, message, itemId);
    }
  });
}

async function addTeamLeads(
  teamId: string,
  excludeUserId: string,
  recipients: Set<string>
): Promise<void> {
  const result = await pool.query(
    `SELECT user_id FROM team_memberships WHERE team_id = $1 AND role = 'lead' AND user_id != $2`,
    [teamId, excludeUserId]
  );
  for (const row of result.rows) {
    recipients.add(row.user_id);
  }
}

async function pollLoop(): Promise<void> {
  console.log("OpsDesk Worker started");
  console.log(`  Batch size: ${BATCH_SIZE}`);
  console.log(`  Max attempts: ${MAX_ATTEMPTS}`);
  console.log(`  Poll interval: ${POLL_INTERVAL}ms`);

  let cleanupCounter = 0;

  while (running) {
    try {
      // Recover stale processing events periodically
      cleanupCounter++;
      if (cleanupCounter % 60 === 0) {
        const recovered = await recoverStaleEvents(60);
        if (recovered > 0) {
          console.log(`Recovered ${recovered} stale events`);
        }

        const cleaned = await cleanExpiredIdempotencyKeys();
        if (cleaned > 0) {
          console.log(`Cleaned ${cleaned} expired idempotency keys`);
        }
      }

      const events = await claimBatch(BATCH_SIZE);

      if (events.length === 0) {
        await sleep(POLL_INTERVAL);
        continue;
      }

      console.log(`Processing ${events.length} events`);

      for (const event of events) {
        try {
          await processEvent(event);
          await markProcessed(event.id, event.locked_at);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`Failed to process event ${event.id}:`, errorMsg);
          await markFailed(event.id, errorMsg, event.attempts, MAX_ATTEMPTS);
        }
      }
    } catch (error) {
      console.error("Worker poll error:", error);
      await sleep(POLL_INTERVAL * 5);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("Worker received SIGTERM, shutting down...");
  running = false;
});

process.on("SIGINT", () => {
  console.log("Worker received SIGINT, shutting down...");
  running = false;
});

pollLoop()
  .then(async () => {
    await pool.end();
    console.log("Worker stopped");
  })
  .catch(async (error) => {
    console.error("Worker crashed:", error);
    await pool.end();
    process.exit(1);
  });
