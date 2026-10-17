import { apiClient } from "./client";
import type { Approval, WorkItem } from "../types";

export async function getPendingApprovals(): Promise<{ approvals: Approval[] }> {
  return apiClient<{ approvals: Approval[] }>("/approvals/pending");
}

export async function approveItem(
  approvalId: string,
  expectedVersion: number
): Promise<{ item: WorkItem }> {
  return apiClient<{ item: WorkItem }>(`/approvals/${approvalId}/approve`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion }),
  });
}

export async function rejectItem(
  approvalId: string,
  expectedVersion: number,
  reason: string
): Promise<{ item: WorkItem }> {
  return apiClient<{ item: WorkItem }>(`/approvals/${approvalId}/reject`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion, reason }),
  });
}

export const approvalsApi = {
  getPendingApprovals,
  approveItem,
  rejectItem,
};

