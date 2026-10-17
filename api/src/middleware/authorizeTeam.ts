import type { RequestHandler } from "express";
import { HttpError } from "../utils/HttpError";
import { pool } from "../db/pool";

export type TeamAction =
  | "view"
  | "comment"
  | "create"
  | "claim"
  | "edit"
  | "transition"
  | "approve"
  | "viewMembers";

const ROLE_PERMISSIONS: Record<string, Set<TeamAction>> = {
  viewer: new Set(["view", "viewMembers"]),
  member: new Set(["view", "viewMembers", "comment", "create", "claim", "edit", "transition"]),
  lead: new Set(["view", "viewMembers", "comment", "create", "claim", "edit", "transition", "approve"]),
};

export function authorizeTeam(action: TeamAction): RequestHandler {
  return async (req, _res, next) => {
    const userId = req.user?.id;
    if (!userId) {
      return next(new HttpError(401, "Authentication required"));
    }

    // teamId may come from params, body, or query
    const teamId = req.params.teamId || req.body?.teamId || (req.query.teamId as string);
    if (!teamId) {
      return next(new HttpError(400, "Team ID is required"));
    }

    try {
      const result = await pool.query(
        "SELECT role FROM team_memberships WHERE user_id = $1 AND team_id = $2",
        [userId, teamId]
      );

      if (result.rows.length === 0) {
        // Return 404 to avoid leaking that the team exists (bug fix #8)
        return next(new HttpError(404, "Resource not found"));
      }

      const role = result.rows[0].role as string;
      const permissions = ROLE_PERMISSIONS[role];

      if (!permissions || !permissions.has(action)) {
        return next(new HttpError(403, "Insufficient permissions for this action"));
      }

      req.teamMembership = { teamId, role: role as "viewer" | "member" | "lead" };
      next();
    } catch (error) {
      next(error);
    }
  };
}

// Check membership by looking up the item's team_id
export async function checkItemTeamAccess(
  userId: string,
  itemTeamId: string,
  action: TeamAction
): Promise<{ role: string } | null> {
  const result = await pool.query(
    "SELECT role FROM team_memberships WHERE user_id = $1 AND team_id = $2",
    [userId, itemTeamId]
  );

  if (result.rows.length === 0) return null;

  const role = result.rows[0].role as string;
  const permissions = ROLE_PERMISSIONS[role];

  if (!permissions || !permissions.has(action)) return null;

  return { role };
}
