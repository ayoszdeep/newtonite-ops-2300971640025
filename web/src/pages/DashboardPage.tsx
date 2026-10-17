import React from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  ShieldAlert,
  ArrowRight,
  TrendingUp,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useDashboard } from "../hooks/useDashboard";
import { MetricCard } from "../components/dashboard/MetricCard";
import { NeedsAttention } from "../components/dashboard/NeedsAttention";
import { StatusBadge } from "../components/common/StatusBadge";
import { PriorityBadge } from "../components/common/PriorityBadge";
import { LoadingState } from "../components/common/LoadingState";
import { ErrorState } from "../components/common/ErrorState";

export const DashboardPage: React.FC = () => {
  const { user, activeTeam } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useDashboard();

  if (isLoading) {
    return <LoadingState message="Loading operational dashboard..." />;
  }

  if (error || !data) {
    return (
      <ErrorState
        title="Failed to load dashboard"
        message={error?.message || "Could not retrieve operational metrics"}
        onRetry={refetch}
      />
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header Greeting */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            Operations Overview
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Signed in as <span className="text-slate-200 font-medium">{user?.name}</span> •{" "}
            Team: <span className="text-indigo-400 font-medium">{activeTeam?.team_name || "Global"}</span> ({activeTeam?.role || "viewer"})
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to="/items"
            className="px-3.5 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <span>Browse All Items</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* 5 Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Assigned to Me"
          count={data.myAssigned.count}
          icon={CheckCircle2}
          variant="purple"
          subtitle="active items"
          onClick={() => navigate("/items?my=true")}
        />

        <MetricCard
          title="Urgent Unassigned"
          count={data.unassignedHighPriority.count}
          icon={ShieldAlert}
          variant={data.unassignedHighPriority.count > 0 ? "danger" : "default"}
          subtitle="P0 & P1 backlog"
          onClick={() => navigate("/items?priority=P0")}
        />

        <MetricCard
          title="Pending Approvals"
          count={data.pendingApprovals.count}
          icon={AlertTriangle}
          variant={data.pendingApprovals.count > 0 ? "warning" : "default"}
          subtitle="eligible to review"
          onClick={() => navigate("/approvals")}
        />

        <MetricCard
          title="Overdue Items"
          count={data.overdueItems.count}
          icon={Clock}
          variant={data.overdueItems.count > 0 ? "danger" : "default"}
          subtitle="passed due date"
          onClick={() => navigate("/items")}
        />
      </div>

      {/* Needs Attention Multi-List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
            Immediate Attention
          </h2>
          <span className="text-[11px] text-slate-400 font-mono">Live Sync (15s)</span>
        </div>
        <NeedsAttention data={data} />
      </div>

      {/* Recently Updated Items */}
      <div className="rounded-xl bg-[#12141c]/90 border border-slate-800 overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/40">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-indigo-400" />
            <h3 className="text-sm font-semibold text-slate-200">Recently Updated Activity</h3>
          </div>
          <Link to="/items" className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
            View full log <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        <div className="divide-y divide-slate-800/60">
          {data.recentlyUpdated.items.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">
              No recent activity found.
            </div>
          ) : (
            data.recentlyUpdated.items.slice(0, 8).map((item) => (
              <div
                key={item.id}
                onClick={() => navigate(`/items/${item.id}`)}
                className="p-3.5 px-4 flex items-center justify-between hover:bg-slate-800/40 transition-colors cursor-pointer group"
              >
                <div className="min-w-0 pr-4">
                  <div className="text-xs font-medium text-slate-200 truncate group-hover:text-indigo-300 transition-colors">
                    {item.title}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2">
                    <span className="font-mono text-[10px] text-slate-500">#{item.id.slice(0, 8)}</span>
                    <span>•</span>
                    <span className="uppercase text-[10px] text-slate-400 font-mono">{item.team_name}</span>
                    <span>•</span>
                    <span className="capitalize text-slate-400">{item.type}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <PriorityBadge priority={item.priority} />
                  <StatusBadge status={item.status} />
                  <span className="text-[11px] text-slate-400 hidden sm:inline">
                    {new Date(item.updated_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
