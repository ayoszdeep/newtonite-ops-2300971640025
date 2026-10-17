import { apiClient } from "./client";
import type { Team, User, Role } from "../types";

export interface TeamMember extends User {
  role: Role;
  joined_at?: string;
}

export async function listTeams(): Promise<{ teams: Team[] }> {
  return apiClient<{ teams: Team[] }>("/teams");
}

export async function getTeam(teamId: string): Promise<{ team: Team; role: Role }> {
  return apiClient<{ team: Team; role: Role }>(`/teams/${teamId}`);
}

export async function getTeamMembers(teamId: string): Promise<{ members: TeamMember[] }> {
  return apiClient<{ members: TeamMember[] }>(`/teams/${teamId}/members`);
}

export const teamsApi = {
  listTeams,
  getTeam,
  getTeamMembers,
};

