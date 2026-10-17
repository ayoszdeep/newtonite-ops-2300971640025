import React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import type { WorkItem } from "../../types";
import { StatusBadge } from "../common/StatusBadge";
import { PriorityBadge } from "../common/PriorityBadge";

interface WorkItemTableProps {
  items: WorkItem[];
  isLoading?: boolean;
}

export const WorkItemTable: React.FC<WorkItemTableProps> = ({ items, isLoading }) => {
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="w-full bg-[#12141c]/80 border border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-800">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="p-4 flex items-center justify-between animate-pulse">
            <div className="space-y-2 flex-1 max-w-md">
              <div className="h-4 bg-slate-800 rounded w-3/4"></div>
              <div className="h-3 bg-slate-800/60 rounded w-1/2"></div>
            </div>
            <div className="flex items-center gap-4">
              <div className="h-6 w-16 bg-slate-800 rounded-full"></div>
              <div className="h-6 w-20 bg-slate-800 rounded-full"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="w-full bg-[#12141c]/90 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-900/60 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
            <tr>
              <th className="py-3 px-4">Item</th>
              <th className="py-3 px-4">Type</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Priority</th>
              <th className="py-3 px-4">Team</th>
              <th className="py-3 px-4">Assignee</th>
              <th className="py-3 px-4">Updated</th>
              <th className="py-3 px-2 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {items.map((item) => (
              <tr
                key={item.id}
                onClick={() => navigate(`/items/${item.id}`)}
                className="hover:bg-slate-800/40 transition-colors cursor-pointer group"
              >
                <td className="py-3.5 px-4 font-medium text-slate-100 max-w-xs sm:max-w-md">
                  <div className="truncate group-hover:text-indigo-300 transition-colors">
                    {item.title}
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                    #{item.id.slice(0, 8)} • v{item.version}
                  </div>
                </td>

                <td className="py-3.5 px-4 whitespace-nowrap">
                  <span className="capitalize px-2 py-0.5 rounded bg-slate-800/80 text-slate-300 font-mono text-[11px] border border-slate-700/50">
                    {item.type}
                  </span>
                </td>

                <td className="py-3.5 px-4 whitespace-nowrap">
                  <StatusBadge status={item.status} />
                </td>

                <td className="py-3.5 px-4 whitespace-nowrap">
                  <PriorityBadge priority={item.priority} />
                </td>

                <td className="py-3.5 px-4 whitespace-nowrap text-slate-400 font-mono">
                  {item.team_name}
                </td>

                <td className="py-3.5 px-4 whitespace-nowrap">
                  {item.assignee_name ? (
                    <span className="inline-flex items-center gap-1.5 text-slate-200">
                      <div className="w-5 h-5 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] text-slate-300">
                        {item.assignee_name.charAt(0).toUpperCase()}
                      </div>
                      <span className="truncate max-w-[120px]">{item.assignee_name}</span>
                    </span>
                  ) : (
                    <span className="text-slate-500 italic">Unassigned</span>
                  )}
                </td>

                <td className="py-3.5 px-4 whitespace-nowrap text-slate-400">
                  {new Date(item.updated_at).toLocaleDateString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>

                <td className="py-3.5 px-2 text-right">
                  <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-indigo-400 group-hover:translate-x-0.5 transition-all" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
