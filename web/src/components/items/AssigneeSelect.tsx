import React from "react";

interface AssigneeSelectProps {
  members: Array<{ id: string; name: string; email: string; role: string }>;
  currentAssigneeId?: string | null;
  onAssign: (userId: string) => void;
  isLoading?: boolean;
  disabled?: boolean;
}

export const AssigneeSelect: React.FC<AssigneeSelectProps> = ({
  members,
  currentAssigneeId,
  onAssign,
  isLoading = false,
  disabled = false,
}) => {
  return (
    <select
      value={currentAssigneeId || ""}
      onChange={(e) => {
        if (e.target.value) {
          onAssign(e.target.value);
        }
      }}
      disabled={disabled || isLoading}
      className="w-full text-xs bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
    >
      <option value="" disabled>
        {isLoading ? "Updating..." : "Select assignee..."}
      </option>
      {members.map((member) => (
        <option key={member.id} value={member.id}>
          {member.name} ({member.role})
        </option>
      ))}
    </select>
  );
};
