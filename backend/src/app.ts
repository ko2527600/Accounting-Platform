import express, { Express } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import healthRouter from './routes/health';
import migrationsRouter from './routes/migrations';

dotenv.config();

const app: Express = express();

app.use(cors());
app.use(express.json());

// Health check endpoints
app.use('/health', healthRouter);
app.use('/api/v1/health', healthRouter);

// Migration admin endpoints
app.use('/api/v1/admin/migrations', migrationsRouter);

export default app;

