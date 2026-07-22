# Database Configuration Guide

## Connection Pool Settings

### Overview
The backend uses Prisma Client with PostgreSQL. Proper connection pool configuration is critical for production performance and preventing connection exhaustion under load.

### Configuration Parameters

All connection pool parameters are configured via the `DATABASE_URL` environment variable query parameters:

```bash
DATABASE_URL="postgresql://user:password@host:5432/dbname?schema=public&connection_limit=50&pool_timeout=10&connect_timeout=5&statement_timeout=30000"
```

### Parameter Reference

| Parameter | Default | Production Recommended | Description |
|-----------|---------|------------------------|-------------|
| `connection_limit` | 10 | 50 | Maximum number of database connections in the pool |
| `pool_timeout` | 10 | 10 | Time in seconds to wait for an available connection |
| `connect_timeout` | 5 | 5 | Time in seconds to establish a new database connection |
| `statement_timeout` | none | 30000 | Maximum query execution time in milliseconds |

### Connection Limit Calculation

**Formula:**
```
connection_limit = (Available PostgreSQL connections - reserved) / Number of app instances
```

**Example:**
- PostgreSQL max_connections: 200
- Reserved for admin/monitoring: 20
- Available: 180
- App instances: 3
- **Connection limit per instance: 60**

### Query Logging

The system automatically logs:
- **Slow queries** (>100ms) - `warn` level
- **All queries** (development only, >10ms) - `debug` level
- **Database errors** - `error` level
- **Database warnings** - `warn` level

### Monitoring Queries

#### View Active Connections
```sql
SELECT 
  count(*) as total_connections,
  count(*) FILTER (WHERE state = 'active') as active,
  count(*) FILTER (WHERE state = 'idle') as idle
FROM pg_stat_activity
WHERE datname = 'accounting_db';
```

#### View Long-Running Queries
```sql
SELECT 
  pid,
  now() - pg_stat_activity.query_start AS duration,
  query,
  state
FROM pg_stat_activity
WHERE state != 'idle'
  AND now() - pg_stat_activity.query_start > interval '1 second'
ORDER BY duration DESC;
```

#### Kill Long-Running Query
```sql
SELECT pg_cancel_backend(pid);  -- Graceful cancellation
-- OR
SELECT pg_terminate_backend(pid);  -- Forceful termination
```

### Performance Tuning

#### PostgreSQL Settings (postgresql.conf)

```ini
# Connection Settings
max_connections = 200
shared_buffers = 4GB
effective_cache_size = 12GB

# Query Performance
work_mem = 64MB
maintenance_work_mem = 512MB
random_page_cost = 1.1  # For SSD storage

# Write Performance
wal_buffers = 16MB
checkpoint_completion_target = 0.9
```

#### Index Maintenance

Run `ANALYZE` after bulk data imports:
```sql
ANALYZE accounts;
ANALYZE journal_entries;
ANALYZE journal_entry_lines;
ANALYZE ledgers;
```

### Troubleshooting

#### Connection Pool Exhausted
**Symptom:** `Error: Connection timeout`

**Solutions:**
1. Increase `connection_limit` in DATABASE_URL
2. Reduce query execution time
3. Scale horizontally (add more app instances)
4. Check for connection leaks (unclosed transactions)

#### Slow Queries
**Symptom:** Queries taking >1 second

**Solutions:**
1. Run `EXPLAIN ANALYZE` on slow queries
2. Verify indexes are being used
3. Check for missing indexes
4. Consider query result caching (Redis)

#### Database Connection Failures
**Symptom:** `Error: Connection refused`

**Solutions:**
1. Verify PostgreSQL is running
2. Check firewall rules
3. Verify connection credentials
4. Check PostgreSQL logs: `/var/log/postgresql/`

### Security Considerations

1. **Never log full query parameters in production** (may contain sensitive data)
2. **Use SSL/TLS for database connections:** Add `?sslmode=require` to DATABASE_URL
3. **Rotate JWT_SECRET regularly** in production
4. **Use strong database passwords** (minimum 16 characters, mixed case, numbers, symbols)
5. **Restrict database user permissions** (no SUPERUSER, only required schema access)

### Production Checklist

- [ ] Set `connection_limit` to appropriate value (50-60 per instance)
- [ ] Enable `statement_timeout` to prevent runaway queries (30000ms)
- [ ] Configure SSL/TLS (`sslmode=require`)
- [ ] Set unique `JWT_SECRET` environment variable
- [ ] Enable query logging and monitoring
- [ ] Set up alerting for connection pool exhaustion
- [ ] Configure automatic index maintenance (ANALYZE, VACUUM)
- [ ] Enable PostgreSQL slow query logging
- [ ] Set up database backup and recovery procedures
- [ ] Document rollback procedures for schema migrations
