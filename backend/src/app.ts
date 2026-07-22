import express, { Express } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import healthRouter from './routes/health';
import migrationsRouter from './routes/migrations';
import authRouter from './routes/auth';
import tenantsRouter from './routes/tenants';
import accountsRouter from './routes/accounts';
import journalEntriesRouter from './routes/journalEntries';
import ledgersRouter from './routes/ledgers';
import reportsRouter from './routes/reports';
import { requestLoggerMiddleware } from './middleware/requestLoggerMiddleware';
import { apiRateLimiter, authRateLimiter, onboardingRateLimiter } from './middleware/rateLimiterMiddleware';
import legalRouter from './routes/legal';
import customFieldsRouter from './routes/customFields';

dotenv.config();

const app: Express = express();

app.use(cors());
app.use(express.json());

// ── Observability ──────────────────────────────────────────────────────────────
// Inject X-Request-ID and structured HTTP request/latency logs on every request
app.use(requestLoggerMiddleware);

// ── Traffic Protection ──────────────────────────────────────────────────────────
// Global API rate limiter (100 req/min per tenant or IP)
app.use('/api/', apiRateLimiter);


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

// Migration admin endpoints
app.use('/api/v1/admin/migrations', migrationsRouter);

// Legal documents endpoints
app.use('/api/legal', legalRouter);
app.use('/api/v1/legal', legalRouter);

// Custom fields endpoints (Tier 2 Customization Enforcement Showcase)
app.use('/api/v1/custom-fields', customFieldsRouter);

export default app;


