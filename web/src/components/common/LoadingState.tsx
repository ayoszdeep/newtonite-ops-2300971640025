import React from "react";
import { Loader2 } from "lucide-react";

interface LoadingStateProps {
  message?: string;
  rows?: number;
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  message = "Loading data...",
  rows = 4,
}) => {
  return (
    <div className="w-full space-y-4 py-8 animate-pulse">
      <div className="flex items-center justify-center gap-3 text-slate-400 py-4">
        <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
        <span className="text-sm font-medium">{message}</span>
      </div>

      <div className="space-y-3 px-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="h-12 bg-slate-900/60 rounded-lg border border-slate-800/60 w-full"
          />
        ))}
      </div>
    </div>
  );
};
