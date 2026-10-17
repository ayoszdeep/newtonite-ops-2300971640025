import React, { createContext, useContext, useEffect, useState } from "react";
import { getMe, login as apiLogin, logout as apiLogout } from "../api/auth";
import type { User, TeamMembership } from "../types";

interface AuthContextType {
  user: User | null;
  memberships: TeamMembership[];
  activeTeamId: string | null;
  activeTeam: TeamMembership | undefined;
  setActiveTeamId: (id: string | null) => void;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [memberships, setMemberships] = useState<TeamMembership[]>([]);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = async () => {
    const token = localStorage.getItem("opsdesk_token");
    if (!token) {
      setUser(null);
      setMemberships([]);
      setIsLoading(false);
      return;
    }

    try {
      const data = await getMe();
      setUser(data.user);
      setMemberships(data.memberships);
      if (data.memberships.length > 0 && !activeTeamId) {
        setActiveTeamId(data.memberships[0].team_id);
      }
    } catch {
      localStorage.removeItem("opsdesk_token");
      setUser(null);
      setMemberships([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshUser();
  }, []);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      await apiLogin(email, password);
      await refreshUser();
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    apiLogout();
    setUser(null);
    setMemberships([]);
    setActiveTeamId(null);
  };

  const activeTeam = memberships.find((m) => m.team_id === activeTeamId);

  return (
    <AuthContext.Provider
      value={{
        user,
        memberships,
        activeTeamId,
        activeTeam,
        setActiveTeamId,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
