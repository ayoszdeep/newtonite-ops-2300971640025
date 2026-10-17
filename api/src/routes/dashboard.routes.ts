import { Router } from "express";
import { authenticate } from "../middleware/authenticate";
import { pool } from "../db/pool";

const router = Router();

router.use(authenticate);

router.get("/", async (req, res, next) => {
  try {
    const userId = req.user!.id;

    // Get user's teams
    const teamsResult = await pool.query(
      "SELECT team_id FROM team_memberships WHERE user_id = $1",
      [userId]
    );

    const teamIds = teamsResult.rows.map((r: any) => r.team_id);

    if (teamIds.length === 0) {
      res.json({
        myAssigned: { count: 0, items: [] },
        unassignedHighPriority: { count: 0, items: [] },
        pendingApprovals: { count: 0, items: [] },
        overdueItems: { count: 0, items: [] },
        recentlyUpdated: { items: [] },
      });
      return;
    }

    // My assigned, unresolved items
    const myAssignedResult = await pool.query(
      `SELECT wi.id, wi.title, wi.type, wi.status, wi.priority, wi.due_at, wi.updated_at,
              t.name as team_name
       FROM work_items wi
       JOIN teams t ON t.id = wi.team_id
       WHERE wi.assignee_id = $1
         AND wi.status NOT IN ('RESOLVED', 'CLOSED')
       ORDER BY
         CASE wi.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
         wi.updated_at DESC
       LIMIT 10`,
      [userId]
    );

    const myAssignedCountResult = await pool.query(
      `SELECT COUNT(*) as count FROM work_items
       WHERE assignee_id = $1 AND status NOT IN ('RESOLVED', 'CLOSED')`,
      [userId]
    );

    // Unassigned P0/P1 items in user's teams
    const unassignedResult = await pool.query(
      `SELECT wi.id, wi.title, wi.type, wi.status, wi.priority, wi.due_at, wi.created_at,
              t.name as team_name
       FROM work_items wi
       JOIN teams t ON t.id = wi.team_id
       WHERE wi.team_id = ANY($1)
         AND wi.assignee_id IS NULL
         AND wi.priority IN ('P0', 'P1')
         AND wi.status NOT IN ('RESOLVED', 'CLOSED')
       ORDER BY
         CASE wi.priority WHEN 'P0' THEN 0 ELSE 1 END,
         wi.created_at ASC
       LIMIT 10`,
      [teamIds]
    );

    const unassignedCountResult = await pool.query(
      `SELECT COUNT(*) as count FROM work_items
       WHERE team_id = ANY($1) AND assignee_id IS NULL
         AND priority IN ('P0', 'P1') AND status NOT IN ('RESOLVED', 'CLOSED')`,
      [teamIds]
    );

    // Pending approvals that the user can decide (user must be a lead)
    const leadTeamsResult = await pool.query(
      `SELECT team_id FROM team_memberships WHERE user_id = $1 AND role = 'lead'`,
      [userId]
    );
    const leadTeamIds = leadTeamsResult.rows.map((r: any) => r.team_id);

    let pendingApprovals: any[] = [];
    let pendingApprovalsCount = 0;

    if (leadTeamIds.length > 0) {
      const pendingResult = await pool.query(
        `SELECT a.id, a.requested_at, wi.id as item_id, wi.title, wi.type, wi.priority,
                u.name as requested_by_name, t.name as team_name
         FROM approvals a
         JOIN work_items wi ON wi.id = a.item_id
         JOIN users u ON u.id = a.requested_by
         JOIN teams t ON t.id = wi.team_id
         WHERE a.decision = 'PENDING'
           AND wi.team_id = ANY($1)
           AND a.requested_by != $2
         ORDER BY a.requested_at DESC
         LIMIT 10`,
        [leadTeamIds, userId]
      );

      pendingApprovals = pendingResult.rows;

      const countResult = await pool.query(
        `SELECT COUNT(*) as count FROM approvals a
         JOIN work_items wi ON wi.id = a.item_id
         WHERE a.decision = 'PENDING'
           AND wi.team_id = ANY($1)
           AND a.requested_by != $2`,
        [leadTeamIds, userId]
      );

      pendingApprovalsCount = parseInt(countResult.rows[0].count, 10);
    }

    // Overdue items
    const overdueResult = await pool.query(
      `SELECT wi.id, wi.title, wi.type, wi.status, wi.priority, wi.due_at,
              wi.assignee_id, u.name as assignee_name, t.name as team_name
       FROM work_items wi
       LEFT JOIN users u ON u.id = wi.assignee_id
       JOIN teams t ON t.id = wi.team_id
       WHERE wi.team_id = ANY($1)
         AND wi.due_at < NOW()
         AND wi.status NOT IN ('RESOLVED', 'CLOSED')
       ORDER BY wi.due_at ASC
       LIMIT 10`,
      [teamIds]
    );

    const overdueCountResult = await pool.query(
      `SELECT COUNT(*) as count FROM work_items
       WHERE team_id = ANY($1) AND due_at < NOW()
         AND status NOT IN ('RESOLVED', 'CLOSED')`,
      [teamIds]
    );

    // Recently updated items
    const recentResult = await pool.query(
      `SELECT wi.id, wi.title, wi.type, wi.status, wi.priority, wi.updated_at,
              t.name as team_name
       FROM work_items wi
       JOIN teams t ON t.id = wi.team_id
       WHERE wi.team_id = ANY($1)
       ORDER BY wi.updated_at DESC
       LIMIT 10`,
      [teamIds]
    );

    res.json({
      myAssigned: {
        count: parseInt(myAssignedCountResult.rows[0].count, 10),
        items: myAssignedResult.rows,
      },
      unassignedHighPriority: {
        count: parseInt(unassignedCountResult.rows[0].count, 10),
        items: unassignedResult.rows,
      },
      pendingApprovals: {
        count: pendingApprovalsCount,
        items: pendingApprovals,
      },
      overdueItems: {
        count: parseInt(overdueCountResult.rows[0].count, 10),
        items: overdueResult.rows,
      },
      recentlyUpdated: {
        items: recentResult.rows,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
