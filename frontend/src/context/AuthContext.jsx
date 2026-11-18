import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext();

// Install a lightweight same-origin /api fetch interceptor once so every view
// automatically sends the verified signed JWT (Authorization: Bearer) + HttpOnly cookie.
let authTokenRef = typeof window !== 'undefined' ? sessionStorage.getItem('fairlab_jwt') || '' : '';

if (typeof window !== 'undefined' && !window.__fairlabFetchWrapped) {
  window.__fairlabFetchWrapped = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.startsWith('/api')) {
      const headers = new Headers(init.headers || {});
      if (authTokenRef && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${authTokenRef}`);
      }
      return nativeFetch(input, { ...init, credentials: 'same-origin', headers });
    }
    return nativeFetch(input, init);
  };
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(() => {
    return sessionStorage.getItem('fairlab_user_id') || 'usr-student-ganesh';
  });
  const [authToken, setAuthToken] = useState(() => sessionStorage.getItem('fairlab_jwt') || '');
  const [profile, setProfile] = useState(null);
  const [availableUsers, setAvailableUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const setSession = useCallback((token, user) => {
    authTokenRef = token || '';
    setAuthToken(token || '');
    if (token) {
      sessionStorage.setItem('fairlab_jwt', token);
    } else {
      sessionStorage.removeItem('fairlab_jwt');
    }
    if (user?.user_id) {
      sessionStorage.setItem('fairlab_user_id', user.user_id);
      setCurrentUser(user.user_id);
    }
  }, []);

  const clearSession = useCallback(async () => {
    authTokenRef = '';
    setAuthToken('');
    sessionStorage.removeItem('fairlab_jwt');
    sessionStorage.removeItem('fairlab_signed_in');
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
  }, []);

  // Fetch demo directory (dev/demo only — disabled in production)
  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/users');
      if (res.ok) {
        setAvailableUsers(await res.json());
      }
    } catch {
      // ignore in production
    }
  }, []);

  // Fetch verified user profile
  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', {
        headers: authTokenRef ? {} : { 'x-user-id': currentUser }
      });
      if (res.ok) {
        const data = await res.json();
        setProfile(data);
        if (data?.user?.user_id) {
          setCurrentUser(data.user.user_id);
        }
      }
    } catch (e) {
      console.error('Failed to fetch profile', e);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile, authToken]);

  // Dev/demo persona switch (obtains a fresh signed JWT + HttpOnly cookie from /api/auth/switch-user)
  const switchUser = useCallback(async (userId) => {
    try {
      const res = await fetch('/api/auth/switch-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      if (res.ok) {
        const data = await res.json();
        setSession(data.token, data.user);
        return;
      }
    } catch {
      // fallback in dev
    }
    setCurrentUser(userId);
  }, [setSession]);

  return (
    <AuthContext.Provider value={{
      currentUser,
      authToken,
      profile,
      availableUsers,
      loading,
      setSession,
      clearSession,
      switchUser,
      refreshProfile: fetchProfile
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
