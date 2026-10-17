import React from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Clock, ChevronRight, UserCheck, ShieldAlert } from "lucide-react";
import type { DashboardData } from "../../types";
import { StatusBadge } from "../common/StatusBadge";
import { PriorityBadge } from "../common/PriorityBadge";

interface NeedsAttentionProps {
  data: DashboardData;
}

export const NeedsAttention: React.FC<NeedsAttentionProps> = ({ data }) => {
  const { unassignedHighPriority, overdueItems, pendingApprovals } = data;

  const hasUrgent = unassignedHighPriority.items.length > 0;
  const hasOverdue = overdueItems.items.length > 0;
  const hasApprovals = pendingApprovals.items.length > 0;

  if (!hasUrgent && !hasOverdue && !hasApprovals) {
    return (
      <div className="p-6 rounded-xl bg-[#12141c]/60 border border-slate-800 text-center">
        <div className="inline-flex p-3 rounded-full bg-emerald-500/10 text-emerald-400 mb-2">
          <UserCheck className="w-5 h-5" />
        </div>
        <h4 className="text-sm font-semibold text-slate-200">All clear on urgent items</h4>
        <p className="text-xs text-slate-400 mt-1">No unassigned P0/P1s, overdue items, or pending approvals requiring your attention.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Urgent Unassigned Items */}
      <div className="flex flex-col rounded-xl bg-[#12141c]/80 border border-slate-800 overflow-hidden">
        <div className="p-4 border-b border-slate-800/80 flex items-center justify-between bg-slate-900/40">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
              <ShieldAlert className="w-4 h-4" />
            </span>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Urgent Unassigned ({unassignedHighPriority.count})
            </h3>
          </div>
          <Link to="/items?priority=P0" className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5">
            View all <ChevronRight className="w-3 h-3" />
          </Link>
        </div>

        <div className="p-3 divide-y divide-slate-800/60 flex-1">
          {unassignedHighPriority.items.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400">No urgent unassigned items</div>
          ) : (
            unassignedHighPriority.items.slice(0, 5).map((item) => (
              <Link
                key={item.id}
                to={`/items/${item.id}`}
                className="py-2.5 px-2 flex items-center justify-between hover:bg-slate-800/40 rounded-lg transition-colors group block"
              >
                <div className="min-w-0 pr-3">
                  <div className="text-sm font-medium text-slate-200 truncate group-hover:text-indigo-300 transition-colors">
                    {item.title}
                  </div>
                  <div className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                    <span className="uppercase text-[10px] font-mono">{item.team_name}</span>
                    <span>•</span>
                    <span className="capitalize">{item.type}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <PriorityBadge priority={item.priority} />
                  <StatusBadge status={item.status} />
                </div>
              </Link>
            ))
          )}
        </div>
      </div>

      {/* Pending Approvals */}
      <div className="flex flex-col rounded-xl bg-[#12141c]/80 border border-slate-800 overflow-hidden">
        <div className="p-4 border-b border-slate-800/80 flex items-center justify-between bg-slate-900/40">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <AlertCircle className="w-4 h-4" />
            </span>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Pending Approvals ({pendingApprovals.count})
            </h3>
          </div>
          <Link to="/approvals" className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5">
            Review <ChevronRight className="w-3 h-3" />
          </Link>
        </div>

        <div className="p-3 divide-y divide-slate-800/60 flex-1">
          {pendingApprovals.items.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400">No approvals pending your action</div>
          ) : (
            pendingApprovals.items.slice(0, 5).map((app: any) => (
              <Link
                key={app.id}
                to={`/items/${app.item_id}`}
                className="py-2.5 px-2 flex items-center justify-between hover:bg-slate-800/40 rounded-lg transition-colors group block"
              >
                <div className="min-w-0 pr-3">
                  <div className="text-sm font-medium text-slate-200 truncate group-hover:text-indigo-300 transition-colors">
                    {app.title}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    Requested by <span className="text-slate-300">{app.requested_by_name}</span>
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <PriorityBadge priority={app.priority} />
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    Review
                  </span>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>

      {/* Overdue Items */}
      <div className="flex flex-col rounded-xl bg-[#12141c]/80 border border-slate-800 overflow-hidden">
        <div className="p-4 border-b border-slate-800/80 flex items-center justify-between bg-slate-900/40">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
              <Clock className="w-4 h-4" />
            </span>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Overdue ({overdueItems.count})
            </h3>
          </div>
          <Link to="/items" className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5">
            View all <ChevronRight className="w-3 h-3" />
          </Link>
        </div>

        <div className="p-3 divide-y divide-slate-800/60 flex-1">
          {overdueItems.items.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400">No overdue work items</div>
          ) : (
            overdueItems.items.slice(0, 5).map((item) => (
              <Link
                key={item.id}
                to={`/items/${item.id}`}
                className="py-2.5 px-2 flex items-center justify-between hover:bg-slate-800/40 rounded-lg transition-colors group block"
              >
                <div className="min-w-0 pr-3">
                  <div className="text-sm font-medium text-slate-200 truncate group-hover:text-indigo-300 transition-colors">
                    {item.title}
                  </div>
                  <div className="text-xs text-rose-400/90 mt-1 flex items-center gap-1 font-mono">
                    <Clock className="w-3 h-3" />
                    Due {item.due_at ? new Date(item.due_at).toLocaleDateString() : "Passed"}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <PriorityBadge priority={item.priority} />
                  <StatusBadge status={item.status} />
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
