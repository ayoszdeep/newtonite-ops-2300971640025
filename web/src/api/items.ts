import { apiClient } from "./client";
import type {
  WorkItem,
  WorkItemWithPermissions,
  FilterParams,
  Comment,
  ActivityEvent,
  WorkItemType,
  Priority,
  WorkItemStatus,
} from "../types";

export interface CreateItemPayload {
  teamId: string;
  type: WorkItemType;
  title: string;
  description?: string;
  priority?: Priority;
  requiresApproval?: boolean;
  dueAt?: string | null;
}

export interface UpdateItemPayload {
  expectedVersion: number;
  title?: string;
  description?: string;
  priority?: Priority;
  requiresApproval?: boolean;
  dueAt?: string | null;
}

export interface ListItemsResponse {
  items: WorkItem[];
  nextCursor: string | null;
}

export async function listItems(filters: FilterParams = {}): Promise<ListItemsResponse> {
  return apiClient<ListItemsResponse>("/items", {
    params: {
      teamId: filters.teamId,
      status: filters.status,
      priority: filters.priority,
      assigneeId: filters.assigneeId,
      type: filters.type,
      search: filters.search,
      limit: filters.limit,
      cursor: filters.cursor,
    },
  });
}

export async function getItem(id: string): Promise<WorkItemWithPermissions> {
  return apiClient<WorkItemWithPermissions>(`/items/${id}`);
}

export async function createItem(
  payload: CreateItemPayload,
  idempotencyKey: string
): Promise<{ item: WorkItem }> {
  return apiClient<{ item: WorkItem }>("/items", {
    method: "POST",
    body: JSON.stringify(payload),
    idempotencyKey,
  });
}

export async function updateItem(
  id: string,
  payload: UpdateItemPayload
): Promise<{ item: WorkItem }> {
  return apiClient<{ item: WorkItem }>(`/items/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function claimItem(id: string): Promise<{ item: WorkItem }> {
  return apiClient<{ item: WorkItem }>(`/items/${id}/claim`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function assignItem(
  id: string,
  assigneeId: string,
  expectedVersion: number
): Promise<{ item: WorkItem }> {
  return apiClient<{ item: WorkItem }>(`/items/${id}/assign`, {
    method: "POST",
    body: JSON.stringify({ assigneeId, expectedVersion }),
  });
}

export async function unassignItem(
  id: string,
  expectedVersion: number
): Promise<{ item: WorkItem }> {
  return apiClient<{ item: WorkItem }>(`/items/${id}/unassign`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion }),
  });
}

export async function transitionItem(
  id: string,
  status: WorkItemStatus,
  expectedVersion: number,
  idempotencyKey: string
): Promise<{ item: WorkItem }> {
  return apiClient<{ item: WorkItem }>(`/items/${id}/transition`, {
    method: "POST",
    body: JSON.stringify({ status, expectedVersion }),
    idempotencyKey,
  });
}

export async function listComments(
  itemId: string,
  limit: number = 50,
  cursor?: string
): Promise<{ comments: Comment[]; nextCursor: string | null }> {
  return apiClient<{ comments: Comment[]; nextCursor: string | null }>(
    `/items/${itemId}/comments`,
    {
      params: { limit, cursor },
    }
  );
}

export async function addComment(
  itemId: string,
  body: string,
  idempotencyKey: string
): Promise<{ comment: Comment }> {
  return apiClient<{ comment: Comment }>(`/items/${itemId}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
    idempotencyKey,
  });
}

export async function getItemActivity(
  itemId: string,
  limit: number = 50,
  cursor?: string
): Promise<{ events: ActivityEvent[]; nextCursor: string | null }> {
  return apiClient<{ events: ActivityEvent[]; nextCursor: string | null }>(
    `/items/${itemId}/activity`,
    {
      params: { limit, cursor },
    }
  );
}

export const itemsApi = {
  listItems,
  getItem,
  createItem,
  updateItem,
  claimItem,
  assignItem,
  unassignItem,
  transition: transitionItem,
  transitionItem,
  listComments,
  addComment,
  getActivity: getItemActivity,
  getItemActivity,
};

