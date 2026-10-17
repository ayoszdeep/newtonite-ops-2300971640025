import React, { useState, useRef, useEffect } from "react";
import { LogOut, ChevronDown, Shield } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";

export const UserMenu: React.FC = () => {
  const { user, activeTeam, logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!user) return null;

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2.5 p-1.5 rounded-lg hover:bg-slate-800/80 transition-colors text-left"
      >
        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white text-xs font-semibold shadow-md shadow-indigo-500/20">
          {user.name.charAt(0).toUpperCase()}
        </div>
        <div className="hidden md:block text-left">
          <div className="text-xs font-medium text-slate-200">{user.name}</div>
          <div className="text-[10px] text-slate-400 capitalize">{activeTeam?.role || "Member"}</div>
        </div>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400 hidden md:block" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 rounded-xl bg-[#12141c] border border-slate-800 shadow-2xl py-1 z-50 animate-fade-in text-xs">
          <div className="px-3.5 py-2.5 border-b border-slate-800/80">
            <div className="font-medium text-slate-200">{user.name}</div>
            <div className="text-[11px] text-slate-400 truncate">{user.email}</div>
            {activeTeam && (
              <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800/80 text-[10px] text-indigo-400 border border-slate-700/50">
                <Shield className="w-3 h-3" />
                <span>{activeTeam.team_name} ({activeTeam.role})</span>
              </div>
            )}
          </div>

          <div className="p-1">
            <button
              onClick={() => {
                setIsOpen(false);
                logout();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors text-left font-medium"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
