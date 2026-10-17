import React from "react";
import { RefreshCw, AlertCircle } from "lucide-react";
import type { WorkItem } from "../../types";

interface ConflictDialogProps {
  isOpen: boolean;
  currentItem?: WorkItem | null;
  onReload: () => void;
  onCancel: () => void;
}

export const ConflictDialog: React.FC<ConflictDialogProps> = ({
  isOpen,
  currentItem,
  onReload,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-lg bg-[#12141c] border border-amber-500/30 rounded-xl shadow-2xl p-6 relative">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shrink-0">
            <AlertCircle className="w-6 h-6" />
          </div>

          <div className="flex-1">
            <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
              Concurrent Update Detected
            </h3>
            <p className="mt-2 text-sm text-slate-300 leading-relaxed">
              This work item was modified by another user or background task while you were viewing or editing it.
            </p>

            {currentItem && (
              <div className="mt-4 p-3.5 rounded-lg bg-slate-900/90 border border-slate-800 text-xs text-slate-300 space-y-1.5">
                <div className="font-semibold text-slate-200">Latest server state (v{currentItem.version}):</div>
                <div className="grid grid-cols-2 gap-2 text-slate-400">
                  <div>Status: <span className="text-slate-200 font-medium">{currentItem.status}</span></div>
                  <div>Priority: <span className="text-slate-200 font-medium">{currentItem.priority}</span></div>
                  <div>Assignee: <span className="text-slate-200 font-medium">{currentItem.assignee_name || "Unassigned"}</span></div>
                  <div>Title: <span className="text-slate-200 font-medium truncate block">{currentItem.title}</span></div>
                </div>
              </div>
            )}

            <p className="mt-3 text-xs text-slate-400">
              To avoid overwriting colleague changes, reload to view the latest version.
            </p>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-800 rounded-lg transition-colors border border-slate-700/60"
              >
                Dismiss
              </button>
              <button
                type="button"
                onClick={onReload}
                className="px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-500 rounded-lg transition-colors flex items-center gap-2 shadow-sm"
              >
                <RefreshCw className="w-4 h-4" />
                Reload Latest Version
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
