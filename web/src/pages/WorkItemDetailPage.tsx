import React, { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Shield,
  CheckCircle2,
  XCircle,
  Edit2,
  Save,
  X,
  AlertTriangle,
  UserPlus,
  UserMinus,
} from "lucide-react";
import { itemsApi } from "../api/items";
import { teamsApi } from "../api/teams";
import { approvalsApi } from "../api/approvals";
import { StatusBadge } from "../components/common/StatusBadge";
import { PriorityBadge } from "../components/common/PriorityBadge";
import { CommentsPanel } from "../components/items/CommentsPanel";
import { ActivityTimeline } from "../components/items/ActivityTimeline";
import { AssigneeSelect } from "../components/items/AssigneeSelect";
import { ConflictDialog } from "../components/common/ConflictDialog";
import { LoadingState } from "../components/common/LoadingState";
import { ErrorState } from "../components/common/ErrorState";
import { useAuth } from "../hooks/useAuth";
import type { WorkItemStatus, Priority, WorkItem, WorkItemWithPermissions } from "../types";

export const WorkItemDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [conflictItem, setConflictItem] = useState<WorkItem | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editingVersion, setEditingVersion] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPriority, setEditPriority] = useState<Priority>("P2");
  const [actionError, setActionError] = useState<string | null>(null);

  // Reject modal state
  const [isRejectOpen, setIsRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  if (!id) {
    return <ErrorState title="Invalid URL" message="No item ID specified" />;
  }

  // 1. Fetch Work Item with 10s polling
  const {
    data: itemData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["item-detail", id],
    queryFn: () => itemsApi.getItem(id),
    refetchInterval: 10_000, // Background poll every 10s
  });

  const item = itemData?.item;
  const permissions = itemData?.permissions;

  // 2. Fetch Team Members for assignment
  const { data: membersData } = useQuery({
    queryKey: ["team-members", item?.team_id],
    queryFn: () => (item ? teamsApi.getTeamMembers(item.team_id) : Promise.resolve({ members: [] })),
    enabled: !!item?.team_id,
  });

  const teamMembers = membersData?.members || [];

  // Helper to handle mutation errors (specifically 409 VERSION_CONFLICT)
  const handleMutationError = (err: any) => {
    if (err?.status === 409 || err?.data?.error === "VERSION_CONFLICT") {
      setConflictItem(err?.data?.details?.current || item);
    } else {
      setActionError(err?.message || "Action failed");
    }
  };

  // Claim mutation with optimistic update & rollback
  const claimMutation = useMutation({
    mutationFn: () => itemsApi.claimItem(id),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["item-detail", id] });
      const previous = queryClient.getQueryData<WorkItemWithPermissions>(["item-detail", id]);

      queryClient.setQueryData<WorkItemWithPermissions>(["item-detail", id], (old) => {
        if (!old) return old;
        return {
          ...old,
          item: {
            ...old.item,
            assignee_id: user?.id || null,
            assignee_name: user?.name || "You",
            version: old.item.version + 1,
          },
          permissions: {
            ...old.permissions,
            canClaim: false,
            canUnassign: true,
          },
        };
      });

      return { previous };
    },
    onError: (err: any, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["item-detail", id], context.previous);
      }
      const claimedBy = err?.data?.current?.assignee_name || "another team member";
      if (err?.status === 409 || err?.data?.error === "ALREADY_CLAIMED") {
        setActionError(`Claim race: item already claimed by ${claimedBy}`);
        setConflictItem(err?.data?.current || null);
      } else {
        setActionError(err?.message || "Failed to claim item");
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["item-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  // Assign mutation
  const assignMutation = useMutation({
    mutationFn: (assigneeId: string) =>
      itemsApi.assignItem(id, assigneeId, item!.version),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["item-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: handleMutationError,
  });

  // Unassign mutation
  const unassignMutation = useMutation({
    mutationFn: () => itemsApi.unassignItem(id, item!.version),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["item-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: handleMutationError,
  });

  // Status transition mutation
  const transitionMutation = useMutation({
    mutationFn: (targetStatus: WorkItemStatus) => {
      const idempotencyKey = crypto.randomUUID();
      return itemsApi.transition(
        id,
        targetStatus,
        item!.version,
        idempotencyKey
      );
    },
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["item-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: handleMutationError,
  });

  // Edit item mutation
  const updateMutation = useMutation({
    mutationFn: () =>
      itemsApi.updateItem(id, {
        title: editTitle,
        description: editDescription,
        priority: editPriority,
        expectedVersion: item!.version,
      }),
    onSuccess: () => {
      setIsEditing(false);
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["item-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: handleMutationError,
  });

  // Approval actions (for items in PENDING_APPROVAL)
  const approveMutation = useMutation({
    mutationFn: async () => {
      // Find pending approval for this item
      const pendingData = await approvalsApi.getPendingApprovals();
      const approval = pendingData.approvals.find((a: any) => a.item_id === id);
      if (!approval) throw new Error("Approval record not found or already decided");
      return approvalsApi.approveItem(approval.id, item!.version);
    },
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["item-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["pending-approvals"] });
    },
    onError: handleMutationError,
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      const pendingData = await approvalsApi.getPendingApprovals();
      const approval = pendingData.approvals.find((a: any) => a.item_id === id);
      if (!approval) throw new Error("Approval record not found or already decided");
      return approvalsApi.rejectItem(approval.id, item!.version, rejectReason);
    },
    onSuccess: () => {
      setIsRejectOpen(false);
      setRejectReason("");
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["item-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["pending-approvals"] });
    },
    onError: handleMutationError,
  });

  if (isLoading) {
    return <LoadingState message="Loading work item details..." />;
  }

  if (error || !item) {
    return (
      <ErrorState
        title="Work item not found"
        message="This item might not exist or you don't have permission to view it."
        action={{
          label: "Back to items",
          onClick: () => navigate("/items"),
        }}
      />
    );
  }

  const startEdit = () => {
    setEditTitle(item.title);
    setEditDescription(item.description || "");
    setEditPriority(item.priority);
    setEditingVersion(item.version);
    setIsEditing(true);
  };

  // Determine valid forward transitions based on server permissions or state
  const getAvailableTransitions = (): WorkItemStatus[] => {
    if (permissions?.allowedTransitions && permissions.allowedTransitions.length > 0) {
      return permissions.allowedTransitions;
    }
    switch (item.status) {
      case "OPEN":
        return ["IN_PROGRESS"];
      case "IN_PROGRESS":
        if (item.requires_approval) {
          return ["PENDING_APPROVAL"];
        }
        return ["PENDING_APPROVAL", "RESOLVED"];
      case "PENDING_APPROVAL":
        return []; // Managed via approve / reject
      case "APPROVED":
        return ["RESOLVED"];
      case "REJECTED":
        return ["IN_PROGRESS"];
      case "RESOLVED":
        return ["CLOSED"];
      case "CLOSED":
      default:
        return [];
    }
  };

  const availableTransitions = getAvailableTransitions();

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Navigation & Status Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-slate-400 font-semibold">
                #{item.id.slice(0, 8)}
              </span>
              <span className="text-slate-500">•</span>
              <span className="font-mono text-[11px] text-slate-400">
                v{item.version}
              </span>
              <span className="text-slate-500">•</span>
              <span className="text-xs text-indigo-400 font-medium uppercase font-mono">
                {item.team_name}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <StatusBadge status={item.status} />
          <PriorityBadge priority={item.priority} />
        </div>
      </div>

      {actionError && (
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{actionError}</span>
          </div>
          <button onClick={() => setActionError(null)} className="text-rose-400 hover:text-rose-200">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Main Item Details, Comments & Activity */}
        <div className="lg:col-span-2 space-y-6">
          {/* Item Main Card */}
          <div className="p-6 rounded-xl bg-[#12141c]/90 border border-slate-800 space-y-4">
            {isEditing ? (
              <div className="space-y-4">
                {editingVersion !== null && item.version > editingVersion && (
                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>
                      This item was modified elsewhere (server is now at v{item.version}). Your unsaved edits in this form are preserved.
                    </span>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Title</label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Description</label>
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={4}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 resize-none"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => setIsEditing(false)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => updateMutation.mutate()}
                    disabled={updateMutation.isPending}
                    className="px-3.5 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg flex items-center gap-1.5"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {updateMutation.isPending ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-start justify-between gap-4">
                  <h1 className="text-xl font-bold text-white leading-snug">
                    {item.title}
                  </h1>
                  {permissions?.canEdit && (
                    <button
                      onClick={startEdit}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
                      title="Edit item"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="mt-4 text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">
                  {item.description ? (
                    item.description
                  ) : (
                    <span className="italic text-slate-500">No description provided.</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Comments Panel */}
          <div className="p-6 rounded-xl bg-[#12141c]/90 border border-slate-800">
            <CommentsPanel itemId={item.id} canComment={permissions?.canComment ?? false} />
          </div>

          {/* Audit History Timeline */}
          <div className="p-6 rounded-xl bg-[#12141c]/90 border border-slate-800">
            <ActivityTimeline itemId={item.id} />
          </div>
        </div>

        {/* Right Col: Workflow Actions & Metadata Sidebar */}
        <div className="space-y-6">
          {/* Workflow Execution Box */}
          <div className="p-5 rounded-xl bg-[#12141c]/90 border border-slate-800 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Workflow Status
            </h3>

            {/* If Item is in PENDING_APPROVAL and user is a lead */}
            {item.status === "PENDING_APPROVAL" && (
              <div className="p-3.5 rounded-lg bg-amber-500/10 border border-amber-500/20 space-y-3">
                <div className="text-xs text-amber-300 font-medium flex items-center gap-1.5">
                  <Shield className="w-4 h-4" />
                  <span>Pending Lead Approval</span>
                </div>
                {permissions?.canApprove ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => approveMutation.mutate()}
                      disabled={approveMutation.isPending}
                      className="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors flex items-center justify-center gap-1 shadow-sm"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {approveMutation.isPending ? "Approving..." : "Approve"}
                    </button>
                    <button
                      onClick={() => setIsRejectOpen(true)}
                      className="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-rose-600/80 hover:bg-rose-600 text-white transition-colors flex items-center justify-center gap-1 shadow-sm"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Reject...
                    </button>
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-400">
                    Only a lead of this team (excluding the requester) can approve or reject this item.
                  </div>
                )}
              </div>
            )}

            {/* Available Forward Status Transitions */}
            {availableTransitions.length > 0 && permissions?.canTransition && (
              <div className="space-y-2">
                <div className="text-[11px] text-slate-400 font-medium">Advance Status to:</div>
                <div className="flex flex-wrap gap-2">
                  {availableTransitions.map((nextStatus) => (
                    <button
                      key={nextStatus}
                      onClick={() => transitionMutation.mutate(nextStatus)}
                      disabled={transitionMutation.isPending}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-all shadow-sm flex items-center gap-1 disabled:opacity-50"
                    >
                      <span>Move to {nextStatus.replace("_", " ")}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {availableTransitions.length === 0 && item.status === "CLOSED" && (
              <div className="text-xs text-slate-400 italic">
                This work item is closed and immutable.
              </div>
            )}
          </div>

          {/* Operational Properties Sidebar */}
          <div className="p-5 rounded-xl bg-[#12141c]/90 border border-slate-800 space-y-4 text-xs">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Details
            </h3>

            {/* Assignment Section */}
            <div className="space-y-1.5 pt-1">
              <div className="text-slate-400 font-medium flex items-center justify-between">
                <span>Assignee</span>
                {item.assignee_id && permissions?.canUnassign && (
                  <button
                    onClick={() => unassignMutation.mutate()}
                    disabled={unassignMutation.isPending}
                    className="text-[11px] text-rose-400 hover:text-rose-300 flex items-center gap-0.5"
                  >
                    <UserMinus className="w-3 h-3" />
                    Unassign
                  </button>
                )}
              </div>

              {item.assignee_id ? (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-900 border border-slate-800">
                  <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-medium text-slate-200">
                    {item.assignee_name?.charAt(0).toUpperCase()}
                  </div>
                  <div className="font-medium text-slate-200">{item.assignee_name}</div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/80 text-slate-500 italic">
                    Unassigned
                  </div>
                  {permissions?.canClaim && (
                    <button
                      onClick={() => claimMutation.mutate()}
                      disabled={claimMutation.isPending}
                      className="w-full py-1.5 text-xs font-medium rounded-lg bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 border border-indigo-500/30 transition-colors flex items-center justify-center gap-1.5"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      {claimMutation.isPending ? "Claiming..." : "Claim this item"}
                    </button>
                  )}
                </div>
              )}

              {/* Reassign select dropdown for members/leads */}
              {permissions?.canAssign && teamMembers.length > 0 && (
                <div className="pt-2">
                  <span className="text-[10px] text-slate-500 block mb-1">
                    {item.assignee_id ? "Reassign to:" : "Or assign to:"}
                  </span>
                  <AssigneeSelect
                    members={teamMembers}
                    currentAssigneeId={item.assignee_id}
                    onAssign={(userId) => assignMutation.mutate(userId)}
                    isLoading={assignMutation.isPending}
                  />
                </div>
              )}
            </div>

            <div className="border-t border-slate-800/80 my-3" />

            {/* Other Meta */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Type</span>
                <span className="capitalize font-mono text-slate-200">{item.type}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400">Team</span>
                <span className="font-mono text-slate-200">{item.team_name}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400">Created By</span>
                <span className="text-slate-200 font-medium">{item.created_by_name}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400">Requires Approval</span>
                <span className={item.requires_approval ? "text-amber-400 font-medium" : "text-slate-500"}>
                  {item.requires_approval ? "Yes" : "No"}
                </span>
              </div>

              {item.due_at && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Due Date</span>
                  <span className="text-slate-200 font-mono">
                    {new Date(item.due_at).toLocaleDateString()}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-slate-400">Last Updated</span>
                <span className="text-slate-400">
                  {new Date(item.updated_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Conflict Dialog (409 VERSION_CONFLICT) */}
      <ConflictDialog
        isOpen={!!conflictItem}
        currentItem={conflictItem}
        onReload={() => {
          setConflictItem(null);
          refetch();
        }}
        onCancel={() => setConflictItem(null)}
      />

      {/* Reject Reason Dialog */}
      {isRejectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md bg-[#12141c] border border-rose-500/30 rounded-xl shadow-2xl p-6 relative">
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <XCircle className="w-5 h-5 text-rose-400" />
              Reject Work Item
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Please provide a clear reason for rejecting this work item. The requester will be notified.
            </p>

            <div className="mt-4">
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reason for rejection (mandatory)..."
                rows={3}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-rose-500 resize-none"
              />
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsRejectOpen(false)}
                className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!rejectReason.trim() || rejectMutation.isPending}
                onClick={() => rejectMutation.mutate()}
                className="px-4 py-2 text-xs font-medium text-white bg-rose-600 hover:bg-rose-500 rounded-lg shadow-sm disabled:opacity-50"
              >
                {rejectMutation.isPending ? "Rejecting..." : "Confirm Rejection"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
