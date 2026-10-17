import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool";
import { HttpError } from "../utils/HttpError";

const BCRYPT_ROUNDS = 10;
// Dummy hash for timing-safe login rejection (bug fix #15)
const DUMMY_HASH = "$2b$10$dummyhashvaluetopreventtimingattacksenumerating";

export interface LoginResult {
  token: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const normalizedEmail = email.toLowerCase().trim();

  const result = await pool.query(
    "SELECT id, name, email, password_hash, is_active FROM users WHERE email = $1",
    [normalizedEmail]
  );

  const user = result.rows[0];

  if (!user) {
    // Prevent user enumeration by still running bcrypt compare
    await bcrypt.compare(password, DUMMY_HASH);
    throw new HttpError(401, "Invalid email or password");
  }

  if (!user.is_active) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw new HttpError(401, "Invalid email or password");
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw new HttpError(401, "Invalid email or password");
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not configured");

  const signOptions: jwt.SignOptions = {
    subject: user.id,
    algorithm: "HS256",
    expiresIn: (process.env.JWT_EXPIRES_IN ?? "1h") as jwt.SignOptions["expiresIn"],
    issuer: "opsdesk-api",
    audience: "opsdesk-web",
  };

  const token = jwt.sign({}, secret, signOptions);

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
    },
  };
}

export async function getMe(userId: string) {
  const userResult = await pool.query(
    "SELECT id, name, email, is_active, created_at FROM users WHERE id = $1",
    [userId]
  );

  if (userResult.rows.length === 0) {
    throw new HttpError(404, "User not found");
  }

  const membershipsResult = await pool.query(
    `SELECT tm.team_id, tm.role, t.name as team_name, t.slug as team_slug
     FROM team_memberships tm
     JOIN teams t ON t.id = tm.team_id
     WHERE tm.user_id = $1
     ORDER BY t.name`,
    [userId]
  );

  return {
    user: userResult.rows[0],
    memberships: membershipsResult.rows,
  };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}
