import app from './app';
import { connectDatabase, disconnectDatabase } from './config/db';
import { connectRedis, disconnectRedis } from './config/redis';
import { startTelemetry, stopTelemetry } from './config/telemetry';
import { initSyncSocketServer } from './websocket/syncSocketServer';
import { initPresenceSocketServer } from './websocket/presenceSocketServer';

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

    // Initialize the local-first sync pilot's WebSocket push channel
    initSyncSocketServer(server);

    // Initialize live "who's online" presence tracking
    initPresenceSocketServer(server);

    // Initialize Monday 8:00 AM Automated Email Reporting Cron Job
    const { ScheduledEmailCronService } = require('./services/scheduledEmailService');
    ScheduledEmailCronService.init();

    // Initialize hourly Recurring Transactions generator
    const { RecurringTransactionCronService } = require('./services/recurringTransactionService');
    RecurringTransactionCronService.init();

    // Initialize FX rate cache refresher (no-op if FX_RATE_API_KEY isn't configured)
    const { FxRateCronService } = require('./services/fxRateCronService');
    FxRateCronService.init();

    // Initialize daily overdue-invoice payment reminder (dunning) sweep
    const { DunningReminderCronService } = require('./services/dunningReminderService');
    DunningReminderCronService.init();

    // Initialize daily Help Assistant conversation-log retention sweep
    const { HelpAssistantMaintenanceCronService } = require('./services/helpAssistantMaintenanceCronService');
    HelpAssistantMaintenanceCronService.init();

    // Initialize daily scheduled vendor-bill payments sweep
    const { VendorPaymentSchedulingCronService } = require('./services/vendorPaymentSchedulingCronService');
    VendorPaymentSchedulingCronService.init();

    // Initialize daily recurring-invoice generation sweep
    const { RecurringInvoiceCronService } = require('./services/recurringInvoiceCronService');
    RecurringInvoiceCronService.init();
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
