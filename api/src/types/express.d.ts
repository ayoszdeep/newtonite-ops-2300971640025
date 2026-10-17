declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
      };
      teamMembership?: {
        teamId: string;
        role: "viewer" | "member" | "lead";
      };
    }
  }
}

export {};
