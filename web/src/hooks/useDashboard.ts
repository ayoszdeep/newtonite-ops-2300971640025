import { useQuery } from "@tanstack/react-query";
import { getDashboard } from "../api/dashboard";
import { useAuth } from "./useAuth";

export function useDashboard() {
  const { isAuthenticated } = useAuth();

  return useQuery({
    queryKey: ["dashboard"],
    queryFn: getDashboard,
    enabled: isAuthenticated,
    refetchInterval: 15_000, // Poll every 15s for fresh metrics
  });
}
