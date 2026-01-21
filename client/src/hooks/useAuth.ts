import { useQuery } from "@tanstack/react-query";
import type { User } from "@shared/schema";

// Auth is optional. By default it's OFF unless explicitly enabled via Vite env.
const AUTH_ENABLED = import.meta.env.VITE_ENABLE_AUTH === "true";

export function useAuth() {
  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    retry: false,

    // 🚫 Do not hit the endpoint unless auth is explicitly enabled
    enabled: AUTH_ENABLED,

    // Keep it stable (avoid refetch noise)
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  return {
    user: user ?? undefined,
    isLoading: AUTH_ENABLED ? isLoading : false,
    isAuthenticated: !!user,
    authEnabled: AUTH_ENABLED,
  };
}
