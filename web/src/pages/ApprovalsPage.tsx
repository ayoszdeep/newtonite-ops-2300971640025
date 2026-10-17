import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  User,
  ShieldAlert,
} from "lucide-react";
import { approvalsApi } from "../api/approvals";
import { useAuth } from "../hooks/useAuth";
import { PriorityBadge } from "../components/common/PriorityBadge";
import { ConflictDialog } from "../components/common/ConflictDialog";
import { EmptyState } from "../components/common/EmptyState";
import { LoadingState } from "../components/common/LoadingState";
import { ErrorState } from "../components/common/ErrorState";
import type { Approval, WorkItem } from "../types";

export const ApprovalsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { memberships } = useAuth();

  const [conflictItem, setConflictItem] = useState<WorkItem | null>(null);
  const [rejectingApproval, setRejectingApproval] = useState<Approval | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const isLeadInAnyTeam = memberships.some((m) => m.role === "lead");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["pending-approvals"],
    queryFn: () => approvalsApi.getPendingApprovals(),
    refetchInterval: 10_000,
  });

  const handleMutationError = (err: any) => {
    if (err?.status === 409 || err?.data?.error === "VERSION_CONFLICT") {
      setConflictItem(err?.data?.details?.current || null);
    } else {
      setActionError(err?.message || "Failed to process approval");
    }
  };

  const approveMutation = useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      approvalsApi.approveItem(id, version),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["pending-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: handleMutationError,
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, version, reason }: { id: string; version: number; reason: string }) =>
      approvalsApi.rejectItem(id, version, reason),
    onSuccess: () => {
      setRejectingApproval(null);
      setRejectReason("");
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["pending-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: handleMutationError,
  });

  const approvals = data?.approvals || [];

  if (isLoading) {
    return <LoadingState message="Loading pending approvals..." />;
  }

  if (error) {
    return (
      <ErrorState
        title="Failed to load approvals"
        message={(error as any)?.message || "Network error"}
        onRetry={refetch}
      />
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-indigo-400" />
            Approvals Queue
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Review and sign off on high-impact operational transitions requested by team members.
          </p>
        </div>

        <div className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-300 font-medium">
          {approvals.length} pending review
        </div>
      </div>

      {actionError && (
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{actionError}</span>
          </div>
          <button onClick={() => setActionError(null)} className="text-rose-400 hover:text-rose-200">
            &times;
          </button>
        </div>
      )}

      {!isLeadInAnyTeam ? (
        <div className="p-8 rounded-xl bg-[#12141c]/60 border border-slate-800 text-center">
          <ShieldAlert className="w-8 h-8 text-slate-500 mx-auto mb-2" />
          <h3 className="text-sm font-semibold text-slate-200">Lead Role Required</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            You are not currently designated as a team lead on any workspace. Only team leads can approve or reject workflow transitions.
          </p>
        </div>
      ) : approvals.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No pending approvals"
          description="You're all caught up! Work items submitted for lead approval will appear here."
        />
      ) : (
        <div className="space-y-3">
          {approvals.map((app: any) => (
            <div
              key={app.id}
              className="p-5 rounded-xl bg-[#12141c]/90 border border-slate-800 hover:border-slate-700/80 transition-all shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4"
            >
              <div className="space-y-2 flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <PriorityBadge priority={app.item_priority} />
                  <span className="capitalize px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px] border border-slate-700/50">
                    {app.item_type}
                  </span>
                  <span className="font-mono text-[11px] text-indigo-400 uppercase font-semibold">
                    {app.team_name}
                  </span>
                  <span className="text-slate-500">•</span>
                  <span className="text-[11px] text-slate-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Requested {new Date(app.requested_at).toLocaleDateString([], { month: "short", day: "numeric" })}
                  </span>
                </div>

                <Link
                  to={`/items/${app.item_id}`}
                  className="text-base font-semibold text-slate-100 hover:text-indigo-400 transition-colors block truncate"
                >
                  {app.item_title}
                </Link>

                <div className="text-xs text-slate-400 flex items-center gap-2">
                  <User className="w-3.5 h-3.5 text-slate-500" />
                  <span>
                    Requested by <span className="text-slate-200 font-medium">{app.requested_by_name}</span> ({app.requested_by_email})
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2.5 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-800/80">
                <Link
                  to={`/items/${app.item_id}`}
                  className="px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-800 rounded-lg transition-colors border border-slate-700/60"
                >
                  Inspect Item
                </Link>

                <button
                  onClick={() =>
                    approveMutation.mutate({
                      id: app.id,
                      version: app.item_version,
                    })
                  }
                  disabled={approveMutation.isPending}
                  className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Approve</span>
                </button>

                <button
                  onClick={() => {
                    setRejectingApproval(app);
                    setRejectReason("");
                  }}
                  className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-rose-600/80 hover:bg-rose-600 text-white transition-colors flex items-center gap-1.5 shadow-sm"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Reject...</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Conflict Dialog */}
      <ConflictDialog
        isOpen={!!conflictItem}
        currentItem={conflictItem}
        onReload={() => {
          setConflictItem(null);
          refetch();
        }}
        onCancel={() => setConflictItem(null)}
      />

      {/* Reject Reason Modal */}
      {rejectingApproval && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md bg-[#12141c] border border-rose-500/30 rounded-xl shadow-2xl p-6 relative">
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <XCircle className="w-5 h-5 text-rose-400" />
              Reject Request
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Provide a reason for rejecting{" "}
              <span className="text-slate-200 font-medium">"{rejectingApproval.item_title}"</span>.
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
                onClick={() => setRejectingApproval(null)}
                className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!rejectReason.trim() || rejectMutation.isPending}
                onClick={() =>
                  rejectMutation.mutate({
                    id: rejectingApproval.id,
                    version: rejectingApproval.item_version ?? 1,
                    reason: rejectReason.trim(),
                  })
                }
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
