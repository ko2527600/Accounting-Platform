import express, { Express } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import healthRouter from './routes/health';

dotenv.config();

const app: Express = express();

app.use(cors());
app.use(express.json());

// Health check endpoints
app.use('/health', healthRouter);
app.use('/api/v1/health', healthRouter);

export default app;
