import app from './app';
import { connectDatabase, disconnectDatabase } from './config/db';

const PORT = process.env.PORT || 4000;

const server = app.listen(PORT, async () => {
  console.log(`[Server] Backend microservice running on port ${PORT}`);
  await connectDatabase();
});

const gracefulShutdown = async () => {
  console.log('[Server] Shutting down gracefully...');
  server.close(async () => {
    await disconnectDatabase();
    process.exit(0);
  });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
