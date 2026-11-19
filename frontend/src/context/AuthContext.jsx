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

export const CANONICAL_DEMO_USERS = [
  {
    user_id: 'usr-student-ganesh',
    name: 'Ganesh Kumar',
    roll_no: 'BT23CSE001',
    email: 'ganesh.k@iitbhilai.ac.in',
    role: 'student',
    permissions: [],
    department: 'M.Tech Computer Science'
  },
  {
    user_id: 'usr-admin-sharma',
    name: 'Dr. A. K. Sharma',
    roll_no: 'EMP-FAC-012',
    email: 'aksharma@iitbhilai.ac.in',
    role: 'admin',
    permissions: ['POLICY_ADMIN', 'ALLOCATION_ADMIN', 'ACCESS_OPERATOR'],
    department: 'Lab L-106 Faculty Coordinator'
  },
  {
    user_id: 'usr-watchman-ram',
    name: 'Ram Singh (Gate Desk)',
    roll_no: 'EMP-SEC-104',
    email: 'accessdesk.l106@iitbhilai.ac.in',
    role: 'admin',
    permissions: ['ACCESS_OPERATOR'],
    department: 'Lab L-106 Access Desk'
  }
];

export function isGateDeskUser(u) {
  if (!u) return false;
  if (typeof u === 'string') {
    return u === 'usr-watchman-ram' || u === 'accessdesk.l106@iitbhilai.ac.in';
  }
  if (u.user_id === 'usr-watchman-ram') return true;
  if (u.email === 'accessdesk.l106@iitbhilai.ac.in') return true;
  if (u.role === 'watchman') return true;
  const pStr = typeof u.permissions === 'string'
    ? u.permissions
    : (Array.isArray(u.permissions) ? JSON.stringify(u.permissions) : '');
  return pStr.includes('ACCESS_OPERATOR') && !pStr.includes('POLICY_ADMIN') && !pStr.includes('ALLOCATION_ADMIN');
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = sessionStorage.getItem('fairlab_user_id');
      if (stored) return stored;
      const p = window.location.pathname.toLowerCase();
      if (p === '/access' || p === '/gate') return 'usr-watchman-ram';
      const isAdminRoute =
        p.startsWith('/admin') ||
        p === '/overview' ||
        p === '/settings' ||
        p === '/allocation' ||
        p === '/schedule' ||
        p === '/workstations' ||
        p === '/students' ||
        p === '/analytics' ||
        p === '/audit' ||
        window.location.search.includes('workspace=admin');
      if (isAdminRoute) return 'usr-admin-sharma';
    }
    return 'usr-student-ganesh';
  });
  const [authToken, setAuthToken] = useState(() => sessionStorage.getItem('fairlab_jwt') || '');
  const [profile, setProfile] = useState(null);
  const [availableUsers, setAvailableUsers] = useState(CANONICAL_DEMO_USERS);
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
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setAvailableUsers(data);
          return;
        }
      }
    } catch {
      // In production mode /api/auth/users is 403, retain canonical demo users
    }
    setAvailableUsers(CANONICAL_DEMO_USERS);
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

  // Dev/demo persona switch (seamless in both development and production mode)
  const switchUser = useCallback(async (userId) => {
    const target = (availableUsers || []).find(u => u.user_id === userId || u.email === userId) ||
                   CANONICAL_DEMO_USERS.find(u => u.user_id === userId || u.email === userId);

    // 1. In production or demo mode, if target has email, use verified /api/auth/login with 'demo' password
    if (target?.email) {
      try {
        const loginRes = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: target.email, password: 'demo' })
        });
        if (loginRes.ok) {
          const loginData = await loginRes.json();
          setSession(loginData.token, loginData.user);
          sessionStorage.setItem('fairlab_signed_in', '1');
          sessionStorage.removeItem('fairlab_signed_out');
          setProfile(loginData);
          setCurrentUser(loginData.user.user_id);
          return loginData.user;
        }
      } catch (err) {
        console.warn('Login switch fallback failed, trying /switch-user', err);
      }
    }

    // 2. Dev-only fallback
    try {
      const res = await fetch('/api/auth/switch-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      if (res.ok) {
        const data = await res.json();
        setSession(data.token, data.user);
        sessionStorage.setItem('fairlab_signed_in', '1');
        sessionStorage.removeItem('fairlab_signed_out');
        await fetchProfile();
        return data.user;
      }
    } catch {
      // fallback in dev
    }
    setCurrentUser(userId);
  }, [availableUsers, fetchProfile, setSession]);

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
