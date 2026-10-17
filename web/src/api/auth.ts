import { apiClient } from "./client";
import type { User, TeamMembership } from "../types";

export interface LoginResponse {
  token: string;
  user: User;
}

export interface MeResponse {
  user: User;
  memberships: TeamMembership[];
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const data = await apiClient<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  localStorage.setItem("opsdesk_token", data.token);
  return data;
}

export async function getMe(): Promise<MeResponse> {
  return apiClient<MeResponse>("/auth/me");
}

export function logout(): void {
  localStorage.removeItem("opsdesk_token");
}
