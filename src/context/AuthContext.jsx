import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { supabase, isSupabaseConfigured } from '../supabase/config';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // Supabase Auth user object
  const [profile, setProfile] = useState(null); // profiles/{id} row — role/restaurant_id source of truth
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Role/restaurant_id are read LIVE from the `profiles` table (never
  // trusted from a cached JWT claim) so that a disable/role-change by an
  // admin takes effect immediately, not just after the next token refresh.
  const loadProfile = useCallback(async (authUser) => {
    if (!authUser) {
      setProfile(null);
      return null;
    }
    if (authUser.is_anonymous) {
      // Guests never have (and must never accidentally receive) a profile row.
      setProfile(null);
      return null;
    }
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, restaurant_id, role, full_name, phone, is_active, created_at, updated_at')
        .eq('id', authUser.id)
        .maybeSingle();

      if (error) throw error;

      if (data && data.is_active === false) {
        setAuthError('Your account has been disabled. Contact your administrator.');
        await supabase.auth.signOut();
        return null;
      }

      setProfile(data || null);
      return data || null;
    } catch (err) {
      setAuthError(err?.message || 'Failed to load profile');
      setProfile(null);
      return null;
    }
  }, []);

  const refreshClaims = useCallback(async () => {
    const {
      data: { user: currentUser },
    } = await supabase.auth.getUser();
    setUser(currentUser);
    return loadProfile(currentUser);
  }, [loadProfile]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return undefined;
    }

    let initialized = false;

    const { data: subscription } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setAuthError(null);
      const nextUser = session?.user || null;
      setUser(nextUser);

      if (!nextUser) {
        setProfile(null);
        setLoading(false);
        initialized = true;
        return;
      }

      await loadProfile(nextUser);
      if (mountedRef.current) setLoading(false);
      initialized = true;
    });

    // Safety net: if no auth event fires within a beat (e.g. no existing
    // session at all), don't leave the app stuck on the loading screen.
    supabase.auth.getSession().then(({ data }) => {
      if (!initialized && mountedRef.current) {
        setUser(data.session?.user || null);
        if (data.session?.user) {
          loadProfile(data.session.user).finally(() => mountedRef.current && setLoading(false));
        } else {
          setLoading(false);
        }
      }
    });

    return () => subscription.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loginWithEmail = useCallback(async (email, password) => {
    setAuthError(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return { success: true };
    } catch (err) {
      const message = mapAuthError(err);
      setAuthError(message);
      return { success: false, error: message };
    }
  }, []);

  const loginAsGuest = useCallback(async () => {
    setAuthError(null);
    try {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      return { success: true, uid: data.user?.id };
    } catch (err) {
      const message = mapAuthError(err);
      setAuthError(message);
      return { success: false, error: message };
    }
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const role = profile?.role || null;
  const restaurantId = profile?.restaurant_id || null;

  const value = {
    user,
    claims: profile ? { role: profile.role, restaurantId: profile.restaurant_id } : null,
    role,
    restaurantId,
    profile,
    isGuest: !!user?.is_anonymous,
    loading,
    authError,
    loginWithEmail,
    loginAsGuest,
    logout,
    refreshClaims,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

function mapAuthError(err) {
  const message = err?.message || '';
  if (/invalid login credentials/i.test(message)) return 'Incorrect email or password.';
  if (/too many requests/i.test(message)) return 'Too many attempts. Please wait a moment and try again.';
  if (/user is disabled|banned/i.test(message)) return 'This account has been disabled.';
  if (/network/i.test(message)) return 'Network error. Check your connection and try again.';
  if (/anonymous sign-ins are disabled/i.test(message)) {
    return 'Guest ordering is temporarily unavailable. Please tell restaurant staff.';
  }
  return message || 'Something went wrong. Please try again.';
}
