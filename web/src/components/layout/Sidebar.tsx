import React from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  CheckSquare,
  ShieldCheck,
  Layers,
  ChevronDown,
} from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { approvalsApi } from "../../api/approvals";

export const Sidebar: React.FC = () => {
  const { memberships, activeTeamId, setActiveTeamId, activeTeam } = useAuth();

  // Query pending approvals count for the badge
  const { data: approvalsData } = useQuery({
    queryKey: ["pending-approvals"],
    queryFn: () => approvalsApi.getPendingApprovals(),
    refetchInterval: 15000,
    enabled: !!activeTeam && activeTeam.role === "lead",
  });

  const pendingCount = approvalsData?.approvals?.length ?? 0;

  const navItems = [
    {
      to: "/",
      label: "Dashboard",
      icon: LayoutDashboard,
      end: true,
    },
    {
      to: "/items",
      label: "Work Items",
      icon: CheckSquare,
    },
    {
      to: "/approvals",
      label: "Approvals",
      icon: ShieldCheck,
      badge: pendingCount > 0 ? pendingCount : undefined,
    },
  ];

  return (
    <aside className="w-64 bg-[#0c0d12] border-r border-slate-800 flex flex-col justify-between shrink-0 select-none">
      <div>
        {/* Logo */}
        <div className="h-14 px-5 flex items-center justify-between border-b border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-600/30">
              <Layers className="w-4 h-4" />
            </div>
            <span className="font-bold text-sm tracking-tight text-white">
              OpsDesk
            </span>
          </div>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            PROD
          </span>
        </div>

        {/* Team Switcher */}
        <div className="p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 px-2 mb-1.5">
            Active Workspace
          </div>
          {memberships.length > 0 ? (
            <div className="relative">
              <select
                value={activeTeamId || ""}
                onChange={(e) => setActiveTeamId(e.target.value)}
                className="w-full appearance-none bg-[#12141c] hover:bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 font-medium cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors pr-8"
              >
                {memberships.map((m) => (
                  <option key={m.team_id} value={m.team_id}>
                    {m.team_name} ({m.role})
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          ) : (
            <div className="text-xs text-slate-500 px-2 py-1 italic">
              No team assigned
            </div>
          )}
        </div>

        {/* Navigation Links */}
        <nav className="px-3 py-2 space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 px-2 mb-2">
            Operations
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    isActive
                      ? "bg-indigo-600/15 text-indigo-400 border border-indigo-500/20"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                  }`
                }
              >
                <div className="flex items-center gap-2.5">
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </div>
                {item.badge !== undefined && (
                  <span className="px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-mono font-semibold border border-amber-500/30">
                    {item.badge}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>
      </div>

      {/* Footer Info */}
      <div className="p-3 border-t border-slate-800/80">
        <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-mono text-slate-300">Outbox Engine</span>
          </div>
          <span className="text-[10px] text-emerald-400 font-medium">Healthy</span>
        </div>
      </div>
    </aside>
  );
};
