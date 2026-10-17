import { Router } from "express";
import { authenticate } from "../middleware/authenticate";
import * as notificationsService from "../services/notifications.service";

const router = Router();

router.use(authenticate);

// List notifications
router.get("/", async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    let cursor: { createdAt: string; id: string } | undefined;

    if (req.query.cursor) {
      try {
        cursor = JSON.parse(
          Buffer.from(req.query.cursor as string, "base64").toString("utf-8")
        );
      } catch {
        res.status(400).json({ error: "VALIDATION_ERROR", message: "Invalid cursor" });
        return;
      }
    }

    const result = await notificationsService.getUserNotifications(
      req.user!.id,
      limit,
      cursor
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Mark one notification read
router.post("/:id/read", async (req, res, next) => {
  try {
    await notificationsService.markRead(req.user!.id, req.params.id);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Mark all notifications read
router.post("/read-all", async (req, res, next) => {
  try {
    const count = await notificationsService.markAllRead(req.user!.id);
    res.json({ success: true, markedCount: count });
  } catch (error) {
    next(error);
  }
});

export default router;
