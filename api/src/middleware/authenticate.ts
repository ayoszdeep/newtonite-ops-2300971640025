import type { RequestHandler } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { HttpError } from "../utils/HttpError";
import { pool } from "../db/pool";

export const authenticate: RequestHandler = async (req, _res, next) => {
  const authorization = req.headers.authorization;
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    return next(new Error("JWT_SECRET is not configured"));
  }

  if (!authorization?.startsWith("Bearer ")) {
    return next(new HttpError(401, "Authentication token is required"));
  }

  const token = authorization.slice("Bearer ".length);

  try {
    const decoded = jwt.verify(token, secret, {
      algorithms: ["HS256"],
      issuer: "opsdesk-api",
      audience: "opsdesk-web",
    }) as JwtPayload;

    if (typeof decoded.sub !== "string") {
      throw new HttpError(401, "Invalid authentication token");
    }

    // Check user is still active (bug fix #13)
    const userResult = await pool.query(
      "SELECT id, is_active FROM users WHERE id = $1",
      [decoded.sub]
    );

    if (userResult.rows.length === 0 || !userResult.rows[0].is_active) {
      throw new HttpError(401, "Account is inactive or not found");
    }

    req.user = { id: decoded.sub };
    next();
  } catch (error) {
    if (error instanceof HttpError) {
      return next(error);
    }
    next(new HttpError(401, "Invalid or expired token"));
  }
};
