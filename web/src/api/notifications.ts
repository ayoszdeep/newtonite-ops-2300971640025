import { apiClient } from "./client";
import type { Notification } from "../types";

export interface NotificationsResponse {
  notifications: Notification[];
  nextCursor: string | null;
  unreadCount: number;
}

export async function getNotifications(
  limit: number = 50,
  cursor?: string
): Promise<NotificationsResponse> {
  return apiClient<NotificationsResponse>("/notifications", {
    params: { limit, cursor },
  });
}

export async function markNotificationRead(id: string): Promise<{ success: boolean }> {
  return apiClient<{ success: boolean }>(`/notifications/${id}/read`, {
    method: "POST",
  });
}

export async function markAllNotificationsRead(): Promise<{ success: boolean; markedCount: number }> {
  return apiClient<{ success: boolean; markedCount: number }>("/notifications/read-all", {
    method: "POST",
  });
}
