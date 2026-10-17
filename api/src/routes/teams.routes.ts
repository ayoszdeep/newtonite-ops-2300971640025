import { Router } from "express";
import { authenticate } from "../middleware/authenticate";
import { pool } from "../db/pool";
import { HttpError } from "../utils/HttpError";

const router = Router();

// All team routes require authentication
router.use(authenticate);

// List teams the user belongs to
router.get("/", async (req, res, next) => {
  try {
    const userId = req.user!.id;

    const result = await pool.query(
      `SELECT t.*, tm.role
       FROM teams t
       JOIN team_memberships tm ON tm.team_id = t.id
       WHERE tm.user_id = $1
       ORDER BY t.name`,
      [userId]
    );

    res.json({ teams: result.rows });
  } catch (error) {
    next(error);
  }
});

// Get team details
router.get("/:id", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const teamId = req.params.id;

    // Check membership
    const membershipResult = await pool.query(
      "SELECT role FROM team_memberships WHERE user_id = $1 AND team_id = $2",
      [userId, teamId]
    );

    if (membershipResult.rows.length === 0) {
      throw new HttpError(404, "Team not found");
    }

    const teamResult = await pool.query(
      "SELECT * FROM teams WHERE id = $1",
      [teamId]
    );

    res.json({
      team: teamResult.rows[0],
      role: membershipResult.rows[0].role,
    });
  } catch (error) {
    next(error);
  }
});

// List team members
router.get("/:id/members", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const teamId = req.params.id;

    // Check membership
    const membershipResult = await pool.query(
      "SELECT role FROM team_memberships WHERE user_id = $1 AND team_id = $2",
      [userId, teamId]
    );

    if (membershipResult.rows.length === 0) {
      throw new HttpError(404, "Team not found");
    }

    const membersResult = await pool.query(
      `SELECT u.id, u.name, u.email, tm.role, tm.created_at as joined_at
       FROM team_memberships tm
       JOIN users u ON u.id = tm.user_id
       WHERE tm.team_id = $1
       ORDER BY
         CASE tm.role
           WHEN 'lead' THEN 1
           WHEN 'member' THEN 2
           WHEN 'viewer' THEN 3
         END,
         u.name`,
      [teamId]
    );

    res.json({ members: membersResult.rows });
  } catch (error) {
    next(error);
  }
});

export default router;
