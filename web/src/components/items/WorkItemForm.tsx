import React, { useState } from "react";
import { X, Plus, AlertCircle } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { itemsApi } from "../../api/items";
import type { WorkItemType, Priority } from "../../types";

interface WorkItemFormProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (item: any) => void;
}

export const WorkItemForm: React.FC<WorkItemFormProps> = ({
  isOpen,
  onClose,
  onCreated,
}) => {
  const { memberships, activeTeam } = useAuth();

  const [teamId, setTeamId] = useState(activeTeam?.team_id || memberships[0]?.team_id || "");
  const [type, setType] = useState<WorkItemType>("task");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("P2");
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [dueAt, setDueAt] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keyRef = React.useRef<string | undefined>(undefined);
  const formValues = { teamId, type, title, description, priority, requiresApproval, dueAt };

  React.useEffect(() => {
    keyRef.current = undefined;
  }, [JSON.stringify(formValues)]);

  if (!isOpen) return null;

  // Filter memberships where user can create (member or lead)
  const eligibleTeams = memberships.filter((m) => m.role === "member" || m.role === "lead");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (!teamId) {
      setError("Please select a team");
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      // Reuse key for identical retry; generate new key if reset by form edit
      if (!keyRef.current) {
        keyRef.current = crypto.randomUUID();
      }
      const idempotencyKey = keyRef.current;

      const result = await itemsApi.createItem(
        {
          teamId,
          type,
          title: title.trim(),
          description: description.trim(),
          priority,
          requiresApproval,
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        },
        idempotencyKey
      );

      onCreated(result.item);
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to create work item");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-xl bg-[#12141c] border border-slate-800 rounded-xl shadow-2xl p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 p-1 rounded-md"
        >
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <Plus className="w-5 h-5 text-indigo-400" />
          Create Work Item
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          Create an operational work item with idempotency and audit tracking.
        </p>

        {error && (
          <div className="mt-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Target Team <span className="text-rose-400">*</span>
              </label>
              <select
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {eligibleTeams.map((m) => (
                  <option key={m.team_id} value={m.team_id}>
                    {m.team_name} ({m.role})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Item Type <span className="text-rose-400">*</span>
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as WorkItemType)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="task">Task</option>
                <option value="incident">Incident</option>
                <option value="payment">Payment Exception</option>
                <option value="compliance">Compliance</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Title <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Investigate wire transfer settlement delay"
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Context, reproduction steps, or resolution criteria..."
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="P0">P0 - Critical / Outage</option>
                <option value="P1">P1 - High</option>
                <option value="P2">P2 - Medium</option>
                <option value="P3">P3 - Low</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Due Date (Optional)
              </label>
              <input
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 [color-scheme:dark]"
              />
            </div>
          </div>

          <div className="pt-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={requiresApproval}
                onChange={(e) => setRequiresApproval(e.target.checked)}
                className="w-4 h-4 rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 bg-slate-900"
              />
              <span className="text-xs text-slate-300 font-medium">
                Requires Lead Approval before resolving
              </span>
            </label>
            <p className="text-[11px] text-slate-500 ml-6 mt-0.5">
              Item will enter PENDING_APPROVAL and require a team lead's sign-off before it can be closed.
            </p>
          </div>

          <div className="mt-6 flex justify-end gap-3 pt-3 border-t border-slate-800/80">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-800 rounded-lg transition-colors border border-slate-700/60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors shadow-sm disabled:opacity-50"
            >
              {isLoading ? "Creating..." : "Create Work Item"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
