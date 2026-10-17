import { apiClient } from "./client";
import type { DashboardData } from "../types";

export async function getDashboard(): Promise<DashboardData> {
  return apiClient<DashboardData>("/dashboard");
}
