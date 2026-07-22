import { register, Counter, Histogram, Gauge } from 'prom-client';

// HTTP Request metrics
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code', 'tenant_id'],
  buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
});

export const httpRequestTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code', 'tenant_id'],
});

export const httpRequestErrors = new Counter({
  name: 'http_request_errors_total',
  help: 'Total number of HTTP request errors',
  labelNames: ['method', 'route', 'status_code', 'tenant_id'],
});

// Database metrics
export const dbQueryDuration = new Histogram({
  name: 'db_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['operation', 'table'],
  buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
});

export const dbConnectionPoolSize = new Gauge({
  name: 'db_connection_pool_size',
  help: 'Current database connection pool size',
});

export const dbConnectionPoolUsed = new Gauge({
  name: 'db_connection_pool_used',
  help: 'Number of used database connections',
});

// Business metrics
export const journalEntriesPosted = new Counter({
  name: 'journal_entries_posted_total',
  help: 'Total number of journal entries posted',
  labelNames: ['tenant_id'],
});

export const accountsCreated = new Counter({
  name: 'accounts_created_total',
  help: 'Total number of accounts created',
  labelNames: ['tenant_id', 'account_type'],
});

export const reportGenerated = new Counter({
  name: 'reports_generated_total',
  help: 'Total number of reports generated',
  labelNames: ['tenant_id', 'report_type'],
});

export const reportGenerationDuration = new Histogram({
  name: 'report_generation_duration_seconds',
  help: 'Duration of report generation',
  labelNames: ['report_type'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
});

export const activeTenantsGauge = new Gauge({
  name: 'active_tenants',
  help: 'Number of active tenants',
});

// Cache metrics
export const cacheHits = new Counter({
  name: 'cache_hits_total',
  help: 'Total number of cache hits',
  labelNames: ['cache_type'],
});

export const cacheMisses = new Counter({
  name: 'cache_misses_total',
  help: 'Total number of cache misses',
  labelNames: ['cache_type'],
});

// Rate limiter metrics
export const rateLimitExceeded = new Counter({
  name: 'rate_limit_exceeded_total',
  help: 'Total number of rate limit exceeded events',
  labelNames: ['limit_type', 'tenant_id'],
});

export { register };
