import { Router } from "express";
import { authenticate } from "../middleware/authenticate";
import { HttpError } from "../utils/HttpError";
import * as itemsService from "../services/items.service";
import { getItemActivity } from "../services/audit.service";
import { checkItemTeamAccess } from "../middleware/authorizeTeam";
import { pool } from "../db/pool";

const router = Router();

router.use(authenticate);

import { z } from "zod";

const querySchema = z.object({
  teamId: z.string().uuid().optional(),
  status: z.enum([
    "OPEN", "IN_PROGRESS", "PENDING_APPROVAL",
    "APPROVED", "REJECTED", "RESOLVED", "CLOSED",
  ]).optional(),
  priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
  assigneeId: z.string().uuid().optional(),
  type: z.enum(["incident", "payment", "compliance", "task"]).optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
  cursor: z.string().optional(),
});

// List items
router.get("/", async (req, res, next) => {
  try {
    const query = querySchema.parse(req.query);
    const result = await itemsService.listItems(req.user!.id, {
      teamId: query.teamId,
      status: query.status,
      priority: query.priority,
      assigneeId: query.assigneeId,
      type: query.type,
      search: query.search,
      limit: query.limit,
      cursor: query.cursor,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Create item
router.post("/", async (req, res, next) => {
  try {
    const idempotencyKey = req.headers["idempotency-key"] as string;
    if (!idempotencyKey) {
      throw new HttpError(400, "Idempotency-Key header is required");
    }

    const data = itemsService.createItemSchema.parse(req.body);
    const result = await itemsService.createItem(
      req.user!.id,
      data,
      idempotencyKey,
      req.method,
      req.path,
      req.body
    );

    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

// Get single item
router.get("/:id", async (req, res, next) => {
  try {
    const result = await itemsService.getItem(req.user!.id, req.params.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Update item
router.patch("/:id", async (req, res, next) => {
  try {
    const data = itemsService.updateItemSchema.parse(req.body);
    const item = await itemsService.updateItem(
      req.user!.id,
      req.params.id,
      data
    );
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

// Claim item
router.post("/:id/claim", async (req, res, next) => {
  try {
    const item = await itemsService.claimItem(req.user!.id, req.params.id);
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

// Assign item
router.post("/:id/assign", async (req, res, next) => {
  try {
    const data = itemsService.assignSchema.parse(req.body);
    const item = await itemsService.assignItem(
      req.user!.id,
      req.params.id,
      data.assigneeId,
      data.expectedVersion
    );
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

// Unassign item (design #11)
router.post("/:id/unassign", async (req, res, next) => {
  try {
    const { expectedVersion } = req.body;
    if (!expectedVersion || typeof expectedVersion !== "number") {
      throw new HttpError(400, "expectedVersion is required");
    }
    const item = await itemsService.unassignItem(
      req.user!.id,
      req.params.id,
      expectedVersion
    );
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

// Transition status
router.post("/:id/transition", async (req, res, next) => {
  try {
    const idempotencyKey = req.headers["idempotency-key"] as string;
    if (!idempotencyKey) {
      throw new HttpError(400, "Idempotency-Key header is required");
    }

    const data = itemsService.transitionSchema.parse(req.body);
    const result = await itemsService.transitionItem(
      req.user!.id,
      req.params.id,
      data.status,
      data.expectedVersion,
      idempotencyKey,
      req.method,
      req.originalUrl,
      req.body
    );

    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

// Add comment
router.post("/:id/comments", async (req, res, next) => {
  try {
    const idempotencyKey = req.headers["idempotency-key"] as string;
    if (!idempotencyKey) {
      throw new HttpError(400, "Idempotency-Key header is required");
    }

    const data = itemsService.commentSchema.parse(req.body);
    const result = await itemsService.addComment(
      req.user!.id,
      req.params.id,
      data.body,
      idempotencyKey,
      req.method,
      req.originalUrl,
      req.body
    );

    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

// List comments
router.get("/:id/comments", async (req, res, next) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const result = await itemsService.listComments(
      req.user!.id,
      req.params.id,
      limit,
      req.query.cursor as string | undefined
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Activity history
router.get("/:id/activity", async (req, res, next) => {
  try {
    // Check access first
    const itemResult = await pool.query(
      "SELECT team_id FROM work_items WHERE id = $1",
      [req.params.id]
    );

    if (itemResult.rows.length === 0) {
      throw new HttpError(404, "Work item not found");
    }

    const access = await checkItemTeamAccess(
      req.user!.id,
      itemResult.rows[0].team_id,
      "view"
    );

    if (!access) {
      throw new HttpError(404, "Work item not found");
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    let cursor: { createdAt: string; id: string } | undefined;

    if (req.query.cursor) {
      try {
        cursor = JSON.parse(
          Buffer.from(req.query.cursor as string, "base64").toString("utf-8")
        );
      } catch {
        throw new HttpError(400, "Invalid cursor");
      }
    }

    const result = await getItemActivity(req.params.id, limit, cursor);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
