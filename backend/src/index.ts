import app from './app';
import { connectDatabase, disconnectDatabase } from './config/db';
import { connectRedis, disconnectRedis } from './config/redis';
import { startTelemetry, stopTelemetry } from './config/telemetry';

const PORT = process.env.PORT || 4000;

const startServer = async () => {
  // Initialize telemetry first
  await startTelemetry();
  
  const server = app.listen(PORT, async () => {
    console.log(`[Server] Backend microservice running on port ${PORT}`);
    
    // Initialize database connection
    await connectDatabase();
    
    // Initialize Redis connection
    await connectRedis();

    // Initialize Monday 8:00 AM Automated Email Reporting Cron Job
    const { ScheduledEmailCronService } = require('./services/scheduledEmailService');
    ScheduledEmailCronService.init();
  });

  const gracefulShutdown = async () => {
    console.log('[Server] Shutting down gracefully...');
    server.close(async () => {
      // Disconnect from database
      await disconnectDatabase();
      
      // Disconnect from Redis
      await disconnectRedis();
      
      // Stop telemetry
      await stopTelemetry();
      
      process.exit(0);
    });
    
    // Force shutdown after 30 seconds
    setTimeout(() => {
      console.error('[Server] Forced shutdown after timeout');
      process.exit(1);
    }, 30000);
  };

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
};

startServer().catch(error => {
  console.error('[Server] Failed to start:', error);
  process.exit(1);
});
