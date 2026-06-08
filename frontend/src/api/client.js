import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

// Attach JWT + selected ADOM to every request.
api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('faz_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  const adom = localStorage.getItem('faz_adom');
  if (adom && adom !== 'all') {
    cfg.params = { ...(cfg.params || {}), adom };
  }
  return cfg;
});

// On 401, drop the session and bounce to login.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response && err.response.status === 401) {
      localStorage.removeItem('faz_token');
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export default api;
