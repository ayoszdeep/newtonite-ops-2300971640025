import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/authenticate";
import * as approvalsService from "../services/approvals.service";
import { HttpError } from "../utils/HttpError";

const router = Router();

router.use(authenticate);

// List pending approvals accessible to the user
router.get("/pending", async (req, res, next) => {
  try {
    const approvals = await approvalsService.getPendingApprovals(req.user!.id);
    res.json({ approvals });
  } catch (error) {
    next(error);
  }
});

const approveSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

// Approve an item
router.post("/:id/approve", async (req, res, next) => {
  try {
    const idResult = z.string().uuid().safeParse(req.params.id);
    if (!idResult.success) {
      throw new HttpError(404, "Approval not found");
    }
    const { expectedVersion } = approveSchema.parse(req.body);
    const item = await approvalsService.approveItem(
      req.params.id,
      req.user!.id,
      expectedVersion
    );
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

const rejectSchema = z.object({
  expectedVersion: z.number().int().positive(),
  reason: z.string().min(1).max(2000),
});

// Reject an item
router.post("/:id/reject", async (req, res, next) => {
  try {
    const idResult = z.string().uuid().safeParse(req.params.id);
    if (!idResult.success) {
      throw new HttpError(404, "Approval not found");
    }
    const { expectedVersion, reason } = rejectSchema.parse(req.body);
    const item = await approvalsService.rejectItem(
      req.params.id,
      req.user!.id,
      expectedVersion,
      reason
    );
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

export default router;
