export type Role = "viewer" | "member" | "lead";

export type WorkItemType = "incident" | "payment" | "compliance" | "task";

export type WorkItemStatus =
  | "OPEN"
  | "IN_PROGRESS"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "RESOLVED"
  | "CLOSED";

export type Priority = "P0" | "P1" | "P2" | "P3";

export interface User {
  id: string;
  name: string;
  email: string;
  is_active?: boolean;
  created_at?: string;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  role?: Role;
}

export interface TeamMembership {
  team_id: string;
  role: Role;
  team_name: string;
  team_slug: string;
}

export interface WorkItemPermissions {
  canEdit: boolean;
  canClaim: boolean;
  canTransition: boolean;
  allowedTransitions?: WorkItemStatus[];
  canApprove: boolean;
  canComment: boolean;
  canAssign: boolean;
  canUnassign: boolean;
}

export interface WorkItem {
  id: string;
  team_id: string;
  type: WorkItemType;
  title: string;
  description: string;
  status: WorkItemStatus;
  priority: Priority;
  assignee_id: string | null;
  created_by: string;
  requires_approval: boolean;
  due_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  created_by_name?: string;
  assignee_name?: string | null;
  team_name?: string;
  team_slug?: string;
}

export interface WorkItemWithPermissions {
  item: WorkItem;
  permissions: WorkItemPermissions;
}

export interface Comment {
  id: string;
  item_id: string;
  user_id: string;
  body: string;
  created_at: string;
  user_name?: string;
  user_email?: string;
}

export interface ActivityEvent {
  id: string;
  item_id: string;
  actor_id: string;
  event_type: string;
  before_data?: Record<string, any> | null;
  after_data?: Record<string, any> | null;
  created_at: string;
  actor_name?: string;
  actor_email?: string;
}

export interface Approval {
  id: string;
  item_id: string;
  requested_by: string;
  decided_by?: string | null;
  decision: "PENDING" | "APPROVED" | "REJECTED";
  reason?: string | null;
  requested_at: string;
  decided_at?: string | null;
  item_title?: string;
  item_type?: WorkItemType;
  item_priority?: Priority;
  item_version?: number;
  team_id?: string;
  team_name?: string;
  requested_by_name?: string;
  requested_by_email?: string;
}

export interface Notification {
  id: string;
  event_id: string;
  user_id: string;
  title: string;
  message: string;
  item_id?: string | null;
  read_at: string | null;
  created_at: string;
}

export interface DashboardMetricSummary {
  count: number;
  items: Array<{
    id: string;
    title: string;
    type: WorkItemType;
    status: WorkItemStatus;
    priority: Priority;
    due_at?: string | null;
    created_at?: string;
    updated_at?: string;
    assignee_id?: string | null;
    assignee_name?: string | null;
    team_name?: string;
  }>;
}

export interface DashboardData {
  myAssigned: DashboardMetricSummary;
  unassignedHighPriority: DashboardMetricSummary;
  pendingApprovals: {
    count: number;
    items: Array<{
      id: string;
      requested_at: string;
      item_id: string;
      title: string;
      type: WorkItemType;
      priority: Priority;
      requested_by_name?: string;
      team_name?: string;
    }>;
  };
  overdueItems: DashboardMetricSummary;
  recentlyUpdated: {
    items: Array<{
      id: string;
      title: string;
      type: WorkItemType;
      status: WorkItemStatus;
      priority: Priority;
      updated_at: string;
      team_name: string;
    }>;
  };
}

export interface FilterParams {
  teamId?: string;
  status?: string;
  priority?: string;
  assigneeId?: string;
  type?: string;
  search?: string;
  limit?: number;
  cursor?: string;
}

export interface ApiError {
  error: string;
  message: string;
  details?: Record<string, any>;
}
