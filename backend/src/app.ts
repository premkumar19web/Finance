import cors from 'cors';
import express, { Router } from 'express';
import helmet from 'helmet';
import { authenticate } from './auth/middleware.js';
import { clientIp } from './auth/session.js';
import { config } from './config.js';
import { pool } from './db.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { CSRF_HEADER, csrfProtection, isAllowedOrigin, noStore, rateLimit, requestLogger } from './http/security.js';
import { assignmentsRouter } from './modules/assignments/routes.js';
import { auditRouter } from './modules/audit/routes.js';
import { authRouter } from './modules/auth/routes.js';
import { branchesRouter } from './modules/branches/routes.js';
import { collectionsRouter } from './modules/collections/routes.js';
import { customersRouter } from './modules/customers/routes.js';
import { dashboardRouter } from './modules/dashboard/routes.js';
import { expensesRouter } from './modules/expenses/routes.js';
import { loansRouter } from './modules/loans/routes.js';
import { paymentsRouter } from './modules/payments/routes.js';
import { reportsRouter } from './modules/reports/routes.js';
import { rolesRouter } from './modules/roles/routes.js';
import { settingsRouter } from './modules/settings/routes.js';
import { usersRouter } from './modules/users/routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => callback(null, !origin || isAllowedOrigin(origin)),
      credentials: true, // allow the session cookie
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', CSRF_HEADER],
      exposedHeaders: ['Content-Disposition'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(requestLogger);

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      app: 'Lion Finance API',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/health/db', async (_req, res) => {
    try {
      const result = await pool.query<{ database: string }>('SELECT current_database() AS database');
      res.json({ status: 'ok', database: result.rows[0]?.database });
    } catch (err) {
      // Log the reason server-side only; the client gets a generic message.
      console.error('Database health check failed:', err instanceof Error ? err.message : err);
      res.status(503).json({ status: 'error', message: 'Database unavailable' });
    }
  });

  const api = Router();
  api.use(noStore);
  api.use(csrfProtection);
  api.use(
    rateLimit({
      windowMs: 60_000,
      max: config.NODE_ENV === 'test' ? 100_000 : 600,
      key: (req) => `api:${clientIp(req)}`,
    }),
  );

  api.use('/auth', authRouter);

  // Everything below requires a signed-in user; each route then checks permissions.
  api.use(authenticate);
  api.use('/dashboard', dashboardRouter);
  api.use('/branches', branchesRouter);
  api.use('/users', usersRouter);
  api.use('/roles', rolesRouter);
  api.use('/customers', customersRouter);
  api.use('/loans', loansRouter);
  api.use('/assignments', assignmentsRouter);
  api.use('/collections', collectionsRouter);
  api.use('/payments', paymentsRouter);
  api.use('/expenses', expensesRouter);
  api.use('/reports', reportsRouter);
  api.use('/audit-logs', auditRouter);
  api.use('/settings', settingsRouter);
  api.use(notFoundHandler);

  app.use('/api', api);
  app.use(errorHandler);
  return app;
}
