import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Layers, ArrowRight, AlertCircle, Sparkles } from "lucide-react";
import { useAuth } from "../hooks/useAuth";

const DEMO_USERS = [
  { label: "Team Lead", email: "lead@opsdesk.dev", role: "lead", team: "Payments" },
  { label: "Team Member 1", email: "member@opsdesk.dev", role: "member", team: "Payments" },
  { label: "Team Member 2", email: "member2@opsdesk.dev", role: "member", team: "Payments" },
  { label: "Viewer", email: "viewer@opsdesk.dev", role: "viewer", team: "Payments" },
  { label: "Outsider", email: "outsider@opsdesk.dev", role: "lead", team: "Engineering" },
];

export const LoginPage: React.FC = () => {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const isExpired = searchParams.get("expired") === "1";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    isExpired ? "Your session has expired. Please sign in again." : null
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();

  const from = (location.state as any)?.from?.pathname || "/";

  const handleLogin = async (e?: React.FormEvent, customEmail?: string, customPass?: string) => {
    if (e) e.preventDefault();
    const targetEmail = customEmail || email;
    const targetPassword = customPass || password;

    if (!targetEmail.trim() || !targetPassword) {
      setError("Email and password are required");
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      await login(targetEmail.trim(), targetPassword);
      navigate(from, { replace: true });
    } catch (err: any) {
      setError(err?.message || "Invalid email or password");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuickLogin = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword("password123");
    handleLogin(undefined, demoEmail, "password123");
  };

  return (
    <div className="min-h-screen w-screen flex items-center justify-center bg-[#090a0f] p-4 text-slate-100 font-sans relative overflow-hidden">
      {/* Background glow effects */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-600/15 rounded-full blur-[128px] pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 w-80 h-80 bg-violet-600/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        {/* Brand header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-600 shadow-xl shadow-indigo-600/30 mb-3 border border-indigo-500/30">
            <Layers className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">OpsDesk</h1>
          <p className="text-xs text-slate-400 mt-1">
            Enterprise Operations & Workflow Management System
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-[#12141c]/90 border border-slate-800 rounded-2xl shadow-2xl p-6 backdrop-blur-xl">
          {error && (
            <div className="mb-5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={(e) => handleLogin(e)} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Work Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@opsdesk.dev"
                autoComplete="email"
                className="w-full bg-slate-900/90 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-slate-300">
                  Password
                </label>
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                autoComplete="current-password"
                className="w-full bg-slate-900/90 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full mt-2 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-indigo-600/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? "Signing in..." : "Sign in to Dashboard"}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </form>

          {/* Quick Demo Switcher */}
          <div className="mt-6 pt-5 border-t border-slate-800/80">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-amber-400" /> Demo Quick Sign-in
              </span>
              <span className="text-[10px] text-slate-500 font-mono">pwd: password123</span>
            </div>

            <div className="grid grid-cols-1 gap-2">
              {DEMO_USERS.map((u) => (
                <button
                  key={u.email}
                  type="button"
                  onClick={() => handleQuickLogin(u.email)}
                  disabled={isSubmitting}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800 text-left text-xs transition-colors group cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-200 group-hover:text-indigo-300 transition-colors">
                      {u.label}
                    </span>
                    <span className="text-[10px] text-slate-400">({u.team})</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 group-hover:text-slate-200">
                    {u.role}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="text-center mt-6 text-[11px] text-slate-400">
          OpsDesk • Concurrent-update protected & outbox driven
        </div>
      </div>
    </div>
  );
};
