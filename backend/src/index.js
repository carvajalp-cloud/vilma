import express from 'express';
import cors from 'cors';
import config from './config.js';
import pool from './db/pool.js';

import authRoutes from './routes/auth.js';
import statsRoutes from './routes/stats.js';
import logRoutes from './routes/logs.js';
import deviceRoutes from './routes/devices.js';
import eventRoutes from './routes/events.js';
import reportRoutes from './routes/reports.js';
import userRoutes from './routes/users.js';
import adomRoutes from './routes/adoms.js';

import { startSyslogListener } from './services/syslog.js';

const app = express();
app.set('trust proxy', true);
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'degraded', db: 'unreachable', error: err.message });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/users', userRoutes);
app.use('/api/adoms', adomRoutes);

// 404 for unknown API routes
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Central error handler
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const server = app.listen(config.port, () => {
  console.log(`[api] Vilma backend listening on http://localhost:${config.port}`);
  startSyslogListener();
});

// Graceful shutdown
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n[api] ${sig} received, shutting down...`);
    server.close(() => pool.end().then(() => process.exit(0)));
  });
}

export default app;
