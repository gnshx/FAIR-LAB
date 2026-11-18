import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(() => {
    const saved = localStorage.getItem('fairlab_user_id');
    return saved || 'usr-student-ganesh';
  });
  const [profile, setProfile] = useState(null);
  const [availableUsers, setAvailableUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  // Fetch available users for persona switching
  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/auth/users');
      if (res.ok) {
        const data = await res.json();
        setAvailableUsers(data);
      }
    } catch (e) {
      console.error('Failed to fetch users', e);
    }
  };

  // Fetch profile for current user
  const fetchProfile = async () => {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'x-user-id': currentUser }
      });
      if (res.ok) {
        const data = await res.json();
        setProfile(data);
      }
    } catch (e) {
      console.error('Failed to fetch profile', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  useEffect(() => {
    fetchProfile();
    localStorage.setItem('fairlab_user_id', currentUser);
  }, [currentUser]);

  const switchUser = (userId) => {
    setCurrentUser(userId);
  };

  return (
    <AuthContext.Provider value={{
      currentUser,
      profile,
      availableUsers,
      loading,
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

