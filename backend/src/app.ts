import express, { Express } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import healthRouter from './routes/health';
import migrationsRouter from './routes/migrations';
import authRouter from './routes/auth';
import tenantsRouter from './routes/tenants';

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

// Migration admin endpoints
app.use('/api/v1/admin/migrations', migrationsRouter);

export default app;

