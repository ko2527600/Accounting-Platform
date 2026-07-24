import express, { Express } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import healthRouter from './routes/health';
import metricsRouter from './routes/metrics';
import migrationsRouter from './routes/migrations';
import authRouter from './routes/auth';
import tenantsRouter from './routes/tenants';
import accountsRouter from './routes/accounts';
import journalEntriesRouter from './routes/journalEntries';
import ledgersRouter from './routes/ledgers';
import reportsRouter from './routes/reports';
import { requestLoggerMiddleware } from './middleware/requestLoggerMiddleware';
import { metricsMiddleware } from './middleware/metricsMiddleware';
import { apiRateLimiter, authRateLimiter, onboardingRateLimiter } from './middleware/rateLimiterMiddleware';
import legalRouter from './routes/legal';
import customFieldsRouter from './routes/customFields';
import auditLogsRouter from './routes/auditLogs';
import importRouter from './routes/import';
import aiCategorizationRouter from './routes/aiCategorization';
import scheduledReportsRouter from './routes/scheduledReports';
import bankingRouter from './routes/banking';
import invoicesRouter from './routes/invoices';
import billsRouter from './routes/bills';
import currencyRouter from './routes/currency';
import inventoryRouter from './routes/inventory';
import cashTillRouter from './routes/cashTill';
import analyticsRouter from './routes/analytics';
import notificationsRouter from './routes/notifications';

dotenv.config();

const app: Express = express();

app.use(cors());
app.use(express.json());

// ── Observability ──────────────────────────────────────────────────────────────
// Inject X-Request-ID and structured HTTP request/latency logs on every request
app.use(requestLoggerMiddleware);
app.use(metricsMiddleware);

// ── Traffic Protection ──────────────────────────────────────────────────────────
// Global API rate limiter (100 req/min per tenant or IP)
app.use('/api/', apiRateLimiter);

// Metrics endpoint (no auth required for Prometheus scraping)
app.use('/metrics', metricsRouter);

// Health check endpoints
app.use('/health', healthRouter);
app.use('/api/v1/health', healthRouter);

// Auth endpoints — strict brute-force limiter (10 req/min per IP/tenant)
app.use('/api/v1/auth', authRateLimiter, authRouter);

// Tenant onboarding & management endpoints — strict limiter (5 req/min)
app.use('/api/v1/tenants', onboardingRateLimiter, tenantsRouter);

// Chart of Accounts CRUD endpoints
app.use('/api/v1/accounts', accountsRouter);

// Journal Entries API endpoints
app.use('/api/v1/journal-entries', journalEntriesRouter);

// Ledger Accounts & Transaction History API endpoints
app.use('/api/v1/ledgers', ledgersRouter);

// Financial Reporting API endpoints
app.use('/api/v1/reports', reportsRouter);

// Scheduled reports endpoints
app.use('/api/v1/reports', scheduledReportsRouter);

// Connected Banking & Reconciliation endpoints
app.use('/api/v1/banking', bankingRouter);

// Invoicing & AR endpoints
app.use('/api/v1/invoices', invoicesRouter);

// Vendor Bills & AP endpoints
app.use('/api/v1/bills', billsRouter);

// Multi-Currency & FX endpoints
app.use('/api/v1/currency', currencyRouter);

// Multi-Warehouse & Inventory Logistics (Godowns) endpoints
app.use('/api/v1/inventory', inventoryRouter);

// Cash Till & Daily Closeout endpoints
app.use('/api/v1/tills', cashTillRouter);

// Intelligent Analytics & Decision Engine endpoints
app.use('/api/v1/analytics', analyticsRouter);

// Real-Time & Persistent Notifications endpoints
app.use('/api/v1/notifications', notificationsRouter);

// AI Categorization endpoints
app.use('/api/v1/ai', aiCategorizationRouter);

// Audit logs API endpoints
app.use('/api/v1/audit-logs', auditLogsRouter);

// Bulk data import API endpoints
app.use('/api/v1/import', importRouter);

// Migration admin endpoints
app.use('/api/v1/admin/migrations', migrationsRouter);

// Legal documents endpoints
app.use('/api/legal', legalRouter);
app.use('/api/v1/legal', legalRouter);

// Custom fields endpoints (Tier 2 Customization Enforcement Showcase)
app.use('/api/v1/custom-fields', customFieldsRouter);

export default app;


