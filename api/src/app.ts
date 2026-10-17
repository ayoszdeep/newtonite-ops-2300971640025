import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import { notFoundHandler, errorHandler } from "./middleware/errorHandler";

import authRoutes from "./routes/auth.routes";
import teamRoutes from "./routes/teams.routes";
import itemRoutes from "./routes/items.routes";
import approvalRoutes from "./routes/approvals.routes";
import dashboardRoutes from "./routes/dashboard.routes";
import notificationRoutes from "./routes/notifications.routes";

const app = express();

app.disable("x-powered-by");
app.use(helmet());

app.use(
  cors({
    origin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  })
);

app.use(express.json({ limit: "1mb" }));

// Health check with DB verification
app.get("/api/health", async (_req, res) => {
  try {
    const { pool } = await import("./db/pool");
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch {
    res.status(503).json({ status: "error", message: "Database unavailable" });
  }
});

app.use(
  "/api/auth/login",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  })
);

app.use("/api/auth", authRoutes);
app.use("/api/teams", teamRoutes);
app.use("/api/items", itemRoutes);
app.use("/api/approvals", approvalRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/notifications", notificationRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
