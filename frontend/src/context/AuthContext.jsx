import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Selected ADOM (admins can switch; others fixed to their own). 'all' = all ADOMs.
  const [adom, setAdomState] = useState(localStorage.getItem('faz_adom') || 'all');

  const setAdom = useCallback((value) => {
    localStorage.setItem('faz_adom', value);
    setAdomState(value);
  }, []);

  const loadMe = useCallback(async () => {
    const token = localStorage.getItem('faz_token');
    if (!token) { setUser(null); setLoading(false); return; }
    try {
      const { data } = await api.get('/auth/me');
      setUser(data);
      if (data.role !== 'admin') {
        // Keep the user's current customer selection if it's still one they can access;
        // otherwise default to their primary / first customer.
        const allowed = (data.customers || []).map((c) => String(c.id));
        const cur = localStorage.getItem('faz_adom');
        if (!cur || cur === 'all' || (allowed.length && !allowed.includes(cur))) {
          setAdom(String(data.adom_id ?? allowed[0] ?? ''));
        }
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [setAdom]);

  useEffect(() => { loadMe(); }, [loadMe]);

  const login = async (username, password) => {
    const { data } = await api.post('/auth/login', { username, password });
    localStorage.setItem('faz_token', data.token);
    if (data.user.role !== 'admin') {
      setAdom(String(data.user.adom_id ?? (data.user.adoms && data.user.adoms[0]) ?? ''));
    } else {
      setAdom('all');
    }
    await loadMe();
    return data.user;
  };

  const logout = () => {
    localStorage.removeItem('faz_token');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, adom, setAdom }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
