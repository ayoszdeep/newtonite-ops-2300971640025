import React from "react";
import type { Priority } from "../../types";
import { AlertCircle, ArrowUpRight, ArrowRight, ArrowDown } from "lucide-react";

interface PriorityBadgeProps {
  priority: Priority | string;
  size?: "sm" | "md";
  showLabel?: boolean;
}

const PRIORITY_CONFIG: Record<
  string,
  { label: string; icon: React.FC<{ className?: string }>; bg: string; text: string; border: string }
> = {
  P0: {
    label: "P0 · Critical",
    icon: AlertCircle,
    bg: "bg-red-500/10",
    text: "text-red-400",
    border: "border-red-500/30",
  },
  P1: {
    label: "P1 · High",
    icon: ArrowUpRight,
    bg: "bg-orange-500/10",
    text: "text-orange-400",
    border: "border-orange-500/30",
  },
  P2: {
    label: "P2 · Medium",
    icon: ArrowRight,
    bg: "bg-blue-500/10",
    text: "text-blue-400",
    border: "border-blue-500/30",
  },
  P3: {
    label: "P3 · Low",
    icon: ArrowDown,
    bg: "bg-slate-500/10",
    text: "text-slate-400",
    border: "border-slate-500/30",
  },
};

export const PriorityBadge: React.FC<PriorityBadgeProps> = ({
  priority,
  size = "md",
  showLabel = true,
}) => {
  const config = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.P3;
  const Icon = config.icon;

  const sizeClasses =
    size === "sm" ? "text-xs px-1.5 py-0.5" : "text-xs px-2.5 py-1 font-medium";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border ${config.bg} ${config.text} ${config.border} ${sizeClasses}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {showLabel && <span>{config.label}</span>}
    </span>
  );
};
