import React from "react";
import type { WorkItemStatus } from "../../types";

interface StatusBadgeProps {
  status: WorkItemStatus | string;
  size?: "sm" | "md";
}

const STATUS_CONFIG: Record<
  string,
  { label: string; bg: string; text: string; dot: string; border: string }
> = {
  OPEN: {
    label: "Open",
    bg: "bg-blue-950/60",
    text: "text-blue-400",
    dot: "bg-blue-400",
    border: "border-blue-800/50",
  },
  IN_PROGRESS: {
    label: "In Progress",
    bg: "bg-amber-950/60",
    text: "text-amber-400",
    dot: "bg-amber-400 animate-pulse",
    border: "border-amber-800/50",
  },
  PENDING_APPROVAL: {
    label: "Pending Approval",
    bg: "bg-purple-950/60",
    text: "text-purple-300",
    dot: "bg-purple-400 animate-ping",
    border: "border-purple-800/50",
  },
  APPROVED: {
    label: "Approved",
    bg: "bg-emerald-950/60",
    text: "text-emerald-400",
    dot: "bg-emerald-400",
    border: "border-emerald-800/50",
  },
  REJECTED: {
    label: "Rejected",
    bg: "bg-rose-950/60",
    text: "text-rose-400",
    dot: "bg-rose-400",
    border: "border-rose-800/50",
  },
  RESOLVED: {
    label: "Resolved",
    bg: "bg-teal-950/60",
    text: "text-teal-300",
    dot: "bg-teal-400",
    border: "border-teal-800/50",
  },
  CLOSED: {
    label: "Closed",
    bg: "bg-slate-900",
    text: "text-slate-400",
    dot: "bg-slate-500",
    border: "border-slate-800",
  },
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = "md" }) => {
  const config = STATUS_CONFIG[status] || {
    label: status,
    bg: "bg-slate-900",
    text: "text-slate-400",
    dot: "bg-slate-500",
    border: "border-slate-800",
  };

  const sizeClasses =
    size === "sm" ? "text-xs px-2 py-0.5" : "text-xs px-2.5 py-1 font-medium";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border ${config.bg} ${config.text} ${config.border} ${sizeClasses}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
      <span>{config.label}</span>
    </span>
  );
};
