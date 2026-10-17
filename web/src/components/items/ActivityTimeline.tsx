import React from "react";
import { useQuery } from "@tanstack/react-query";
import { History, CheckCircle, XCircle, Tag, RefreshCw } from "lucide-react";
import { itemsApi } from "../../api/items";
import type { ActivityEvent } from "../../types";

interface ActivityTimelineProps {
  itemId: string;
}

export const ActivityTimeline: React.FC<ActivityTimelineProps> = ({ itemId }) => {
  const { data, isLoading } = useQuery({
    queryKey: ["item-activity", itemId],
    queryFn: () => itemsApi.getActivity(itemId),
    refetchInterval: 15000,
  });

  const events = data?.events || [];

  const renderEventDetails = (event: ActivityEvent) => {
    switch (event.event_type) {
      case "ITEM_CREATED":
        return <span className="text-slate-300">created this work item</span>;

      case "STATUS_CHANGED":
        return (
          <span className="text-slate-300 inline-flex items-center gap-1.5 flex-wrap">
            changed status from{" "}
            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[11px]">
              {event.before_data?.status}
            </span>{" "}
            to{" "}
            <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 font-mono text-[11px]">
              {event.after_data?.status}
            </span>
          </span>
        );

      case "ITEM_CLAIMED":
        return <span className="text-slate-300">claimed this item</span>;

      case "ITEM_ASSIGNED":
        return (
          <span className="text-slate-300">
            assigned item to <span className="text-indigo-400 font-medium">{event.after_data?.assignee_id ? "team member" : "someone"}</span>
          </span>
        );

      case "ITEM_UNASSIGNED":
        return <span className="text-slate-300">unassigned this item</span>;

      case "PRIORITY_CHANGED":
        return (
          <span className="text-slate-300 inline-flex items-center gap-1.5">
            changed priority from{" "}
            <span className="font-mono text-[11px] text-slate-400">{event.before_data?.priority}</span> to{" "}
            <span className="font-mono text-[11px] text-amber-400">{event.after_data?.priority}</span>
          </span>
        );

      case "APPROVAL_APPROVED":
        return <span className="text-emerald-400 font-medium">approved this item</span>;

      case "APPROVAL_REJECTED":
        return (
          <span className="text-rose-400 font-medium">
            rejected: <span className="text-slate-300 font-normal italic">"{event.after_data?.reason}"</span>
          </span>
        );

      case "COMMENT_ADDED":
        return <span className="text-slate-400">added a comment</span>;

      case "ITEM_UPDATED":
        return <span className="text-slate-300">updated item properties</span>;

      default:
        return <span className="text-slate-400">{event.event_type}</span>;
    }
  };

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case "APPROVAL_APPROVED":
        return <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />;
      case "APPROVAL_REJECTED":
        return <XCircle className="w-3.5 h-3.5 text-rose-400" />;
      case "STATUS_CHANGED":
        return <RefreshCw className="w-3.5 h-3.5 text-indigo-400" />;
      case "PRIORITY_CHANGED":
        return <Tag className="w-3.5 h-3.5 text-amber-400" />;
      default:
        return <History className="w-3.5 h-3.5 text-slate-400" />;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
        <History className="w-4 h-4 text-slate-400" />
        <span>Audit History ({events.length})</span>
      </div>

      {isLoading ? (
        <div className="text-xs text-slate-500 py-4 text-center">Loading audit log...</div>
      ) : events.length === 0 ? (
        <div className="text-xs text-slate-500 py-4 text-center italic">No activity recorded yet</div>
      ) : (
        <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
          {events.map((event: ActivityEvent) => (
            <div key={event.id} className="relative group">
              {/* Dot / Icon */}
              <div className="absolute -left-6 top-0.5 w-4 h-4 rounded-full bg-[#0c0d12] border border-slate-700 flex items-center justify-center">
                {getEventIcon(event.event_type)}
              </div>

              <div className="text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-slate-200">
                    {event.actor_name || "System"}
                  </span>
                  {renderEventDetails(event)}
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  {new Date(event.created_at).toLocaleString([], {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
