type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  requestId?: string;
  traceId?: string;
  spanId?: string;
  tenantSlug?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  error?: string;
  stack?: string;
  [key: string]: unknown;
}

function log(level: LogLevel, message: string, context: LogContext = {}): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    hostname: process.env.HOSTNAME || 'localhost',
    pid: process.pid,
    env: process.env.NODE_ENV || 'development',
    message,
    ...context,
  };

  const output = JSON.stringify(entry);

  if (level === 'error') {
    process.stderr.write(output + '\n');
  } else {
    process.stdout.write(output + '\n');
  }
}

export const logger = {
  debug: (message: string, context?: LogContext) => log('debug', message, context),
  info:  (message: string, context?: LogContext) => log('info',  message, context),
  warn:  (message: string, context?: LogContext) => log('warn',  message, context),
  error: (message: string, context?: LogContext | Error) => {
    if (context instanceof Error) {
      log('error', message, {
        error: context.message,
        stack: context.stack,
        name: context.name,
      });
    } else {
      log('error', message, context);
    }
  },
};
