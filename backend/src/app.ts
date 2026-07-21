import express, { Express } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import healthRouter from './routes/health';
import migrationsRouter from './routes/migrations';
import authRouter from './routes/auth';
import tenantsRouter from './routes/tenants';
import accountsRouter from './routes/accounts';
import journalEntriesRouter from './routes/journalEntries';

dotenv.config();

const app: Express = express();

app.use(cors());
app.use(express.json());

// Health check endpoints
app.use('/health', healthRouter);
app.use('/api/v1/health', healthRouter);

// Auth endpoints
app.use('/api/v1/auth', authRouter);

// Tenant onboarding & management endpoints
app.use('/api/v1/tenants', tenantsRouter);

// Chart of Accounts CRUD endpoints
app.use('/api/v1/accounts', accountsRouter);

// Journal Entries API endpoints
app.use('/api/v1/journal-entries', journalEntriesRouter);

// Migration admin endpoints
app.use('/api/v1/admin/migrations', migrationsRouter);

export default app;

