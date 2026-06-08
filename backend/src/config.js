import dotenv from 'dotenv';
dotenv.config();

const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  db: {
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432', 10),
    user: process.env.PGUSER || 'faz',
    password: process.env.PGPASSWORD || 'faz_password',
    database: process.env.PGDATABASE || 'fortianalyzer',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '12h',
  },
  syslog: {
    enabled: (process.env.SYSLOG_ENABLED || 'true') !== 'false',
    port: parseInt(process.env.SYSLOG_PORT || '514', 10),
    host: process.env.SYSLOG_HOST || '0.0.0.0',
  },
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
};

export default config;
