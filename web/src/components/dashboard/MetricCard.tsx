import React from "react";
import type { LucideIcon } from "lucide-react";

interface MetricCardProps {
  title: string;
  count: number;
  icon: LucideIcon;
  variant?: "default" | "warning" | "danger" | "success" | "purple";
  subtitle?: string;
  onClick?: () => void;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  title,
  count,
  icon: Icon,
  variant = "default",
  subtitle,
  onClick,
}) => {
  const variantStyles = {
    default: {
      border: "border-slate-800 hover:border-slate-700",
      iconBg: "bg-slate-800/60 text-slate-300",
      badge: "text-slate-400",
    },
    warning: {
      border: "border-amber-500/20 hover:border-amber-500/40",
      iconBg: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
      badge: "text-amber-400",
    },
    danger: {
      border: "border-rose-500/20 hover:border-rose-500/40",
      iconBg: "bg-rose-500/10 text-rose-400 border border-rose-500/20",
      badge: "text-rose-400",
    },
    success: {
      border: "border-emerald-500/20 hover:border-emerald-500/40",
      iconBg: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
      badge: "text-emerald-400",
    },
    purple: {
      border: "border-indigo-500/20 hover:border-indigo-500/40",
      iconBg: "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20",
      badge: "text-indigo-400",
    },
  }[variant];

  return (
    <div
      onClick={onClick}
      className={`p-5 rounded-xl bg-[#12141c]/90 border transition-all duration-200 ${
        variantStyles.border
      } ${onClick ? "cursor-pointer hover:-translate-y-0.5 shadow-lg shadow-black/20" : ""}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          {title}
        </span>
        <div className={`p-2 rounded-lg ${variantStyles.iconBg}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        <span className="text-3xl font-bold tracking-tight text-white font-mono">
          {count}
        </span>
        {subtitle && (
          <span className="text-xs text-slate-400">
            {subtitle}
          </span>
        )}
      </div>
    </div>
  );
};
