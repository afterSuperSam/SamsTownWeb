import type { Session, User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Profile } from "../domain/types";
import { getCurrentProfile } from "../services/authService";
import { isSupabaseConfigured, supabase } from "../lib/supabase";

interface AuthState {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  refreshSession: () => Promise<Profile | null>;
}

const AuthContext = createContext<AuthState | null>(null);

// Authentication state synchronization ---------------------------------------
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const syncRevision = useRef(0);
  const mounted = useRef(true);
  const settledUserId = useRef<string | null>(null);
  const hasSettledProfile = useRef(false);

  // Keep the session and permission profile in one loading boundary so route
  // guards never evaluate a newly signed-in user against a stale/null profile.
  const synchronizeSession = useCallback(async (session: Session | null): Promise<Profile | null> => {
    const revision = ++syncRevision.current;
    if (!session) {
      if (mounted.current) {
        settledUserId.current = null;
        hasSettledProfile.current = false;
        setUser(null);
        setProfile(null);
        setLoading(false);
      }
      return null;
    }

    const blocksRoute = settledUserId.current !== session.user.id || !hasSettledProfile.current;
    if (mounted.current && blocksRoute) setLoading(true);
    try {
      const nextProfile = await getCurrentProfile();
      if (!mounted.current || revision !== syncRevision.current) return null;
      settledUserId.current = session.user.id;
      hasSettledProfile.current = Boolean(nextProfile);
      setUser(session.user);
      setProfile(nextProfile);
      return nextProfile;
    } catch (error) {
      if (!mounted.current || revision !== syncRevision.current) throw error;
      if (blocksRoute) {
        settledUserId.current = session.user.id;
        hasSettledProfile.current = false;
        setUser(session.user);
        setProfile(null);
      }
      throw error;
    } finally {
      if (mounted.current && revision === syncRevision.current && blocksRoute) setLoading(false);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    const revision = syncRevision.current;
    const nextProfile = await getCurrentProfile();
    if (!mounted.current || revision !== syncRevision.current) return;
    settledUserId.current = nextProfile?.id ?? null;
    hasSettledProfile.current = Boolean(nextProfile);
    setProfile(nextProfile);
  }, []);

  const refreshSession = useCallback(async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return synchronizeSession(data.session);
  }, [synchronizeSession]);

  useEffect(() => {
    mounted.current = true;
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    void refreshSession().catch(() => {
      if (!mounted.current) return;
      setProfile(null);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      queueMicrotask(() => {
        void synchronizeSession(session).catch(() => undefined);
      });
    });
    return () => {
      mounted.current = false;
      syncRevision.current += 1;
      listener.subscription.unsubscribe();
    };
  }, [refreshSession, synchronizeSession]);

  const value = useMemo(
    () => ({ user, profile, loading, refreshProfile, refreshSession }),
    [user, profile, loading, refreshProfile, refreshSession]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
