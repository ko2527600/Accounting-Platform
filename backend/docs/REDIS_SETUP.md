# Redis Setup and Configuration Guide

## Overview
Redis is used for distributed caching and rate limiting in the accounting platform. This enables horizontal scaling across multiple server instances.

## Installation

### Development (Local)

#### Option 1: Docker (Recommended)
```bash
# Run Redis in Docker
docker run -d \
  --name accounting-redis \
  -p 6379:6379 \
  redis:7-alpine \
  redis-server --appendonly yes

# Verify Redis is running
docker exec accounting-redis redis-cli ping
# Expected output: PONG
```

#### Option 2: Native Installation

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install redis-server
sudo systemctl start redis-server
sudo systemctl enable redis-server
```

**macOS (Homebrew):**
```bash
brew install redis
brew services start redis
```

**Windows:**
Download from: https://github.com/microsoftarchive/redis/releases

### Production

#### Managed Redis Services (Recommended)

**AWS ElastiCache:**
```bash
# Create Redis cluster
aws elasticache create-replication-group \
  --replication-group-id accounting-redis \
  --replication-group-description "Accounting Platform Cache" \
  --engine redis \
  --cache-node-type cache.r6g.large \
  --num-cache-clusters 3 \
  --automatic-failover-enabled \
  --at-rest-encryption-enabled \
  --transit-encryption-enabled
```

**Azure Cache for Redis:**
```bash
az redis create \
  --resource-group accounting-rg \
  --name accounting-redis \
  --location eastus \
  --sku Standard \
  --vm-size c1 \
  --enable-non-ssl-port false
```

**Google Cloud Memorystore:**
```bash
gcloud redis instances create accounting-redis \
  --size=5 \
  --region=us-central1 \
  --redis-version=redis_7_0 \
  --tier=standard-ha
```

## Configuration

### Environment Variables

Set `REDIS_URL` in your `.env` file:

```bash
# Development (local)
REDIS_URL="redis://localhost:6379"

# Development with password
REDIS_URL="redis://:password@localhost:6379"

# Production (AWS ElastiCache example)
REDIS_URL="rediss://master.accounting-redis.abc123.use1.cache.amazonaws.com:6379"

# Production with auth
REDIS_URL="rediss://:your-auth-token@your-redis-host.com:6379/0"
```

**URL Format:**
```
redis[s]://[:password@]host[:port][/db-number]
```
- `rediss://` - Use TLS/SSL (required for production)
- `redis://` - Plain text (development only)
- `password` - Optional authentication token
- `host` - Redis server hostname
- `port` - Default: 6379
- `db-number` - Database index (0-15), default: 0

### Connection Pool Settings

Configured in `src/config/redis.ts`:

| Setting | Value | Description |
|---------|-------|-------------|
| `maxRetriesPerRequest` | 3 | Maximum retry attempts per command |
| `connectTimeout` | 10000ms | Connection establishment timeout |
| `commandTimeout` | 5000ms | Command execution timeout |
| `keepAlive` | 30000ms | TCP keep-alive interval |
| `enableOfflineQueue` | false | Fail fast when disconnected |

## Cache Key Patterns

### Tenant Metadata Cache
```
tenant:{identifier}  → Tenant object (JSON)
TTL: 30 minutes (1800 seconds)

Example:
tenant:acme-corp
tenant:550e8400-e29b-41d4-a716-446655440000
```

### Rate Limiting
```
rate_limit:{tenant|ip}:{identifier}  → Request count (integer)
TTL: 60 seconds (sliding window)

Example:
rate_limit:tenant:acme-corp
rate_limit:ip:192.168.1.100
```

### JWT Token Cache
```
jwt:{hash}  → Payload object (JSON)
TTL: Until token expiry

Example:
jwt:a3f2b8c9d1e4f5a6b7c8d9e0f1a2b3c4
```

### Query Result Cache
```
cache:report:{type}:{tenant}:{params}  → Report data (JSON)
TTL: 5 minutes (300 seconds)

Example:
cache:report:trial_balance:acme-corp:2024-01-01:2024-12-31
cache:report:profit_loss:acme-corp:2024-01-01
```

### Account Tree Cache
```
cache:account_tree:{tenant}  → Account tree (JSON)
TTL: 1 hour (3600 seconds)

Example:
cache:account_tree:acme-corp
```

## Cache Utilities

The platform provides convenient cache utilities in `src/config/redis.ts`:

```typescript
import { cacheUtils } from './config/redis';

// Get with automatic JSON parsing
const tenant = await cacheUtils.get<TenantData>('tenant:acme-corp');

// Set with automatic JSON serialization and TTL
await cacheUtils.set('tenant:acme-corp', tenantData, 1800);

// Delete single key
await cacheUtils.del('tenant:acme-corp');

// Delete keys by pattern
await cacheUtils.delPattern('tenant:*');

// Check existence
const exists = await cacheUtils.exists('tenant:acme-corp');

// Atomic increment (for rate limiting)
const count = await cacheUtils.incr('rate_limit:tenant:acme-corp', 60);
```

## Monitoring

### Redis CLI Commands

**Check connection:**
```bash
redis-cli ping
# Expected: PONG
```

**View all keys (development only!):**
```bash
redis-cli keys '*'
```

**Get key value:**
```bash
redis-cli get "tenant:acme-corp"
```

**Check key TTL:**
```bash
redis-cli ttl "tenant:acme-corp"
# Returns seconds until expiry, or -1 if no TTL
```

**View memory usage:**
```bash
redis-cli info memory
```

**View connected clients:**
```bash
redis-cli client list
```

**Monitor commands in real-time:**
```bash
redis-cli monitor
```

### Performance Metrics

**Key metrics to track:**
- Hit rate: `(hits / (hits + misses)) * 100`
- Memory usage: Should stay under 80% of allocated
- Evicted keys: Should be minimal
- Connection count: Monitor for leaks
- Command latency: p99 should be <5ms

**Get cache hit/miss stats:**
```bash
redis-cli info stats | grep keyspace
```

### Health Check

The platform exposes Redis health check:

```typescript
import { isRedisHealthy } from './config/redis';

const healthy = await isRedisHealthy();
// Returns: true if Redis responds to PING
```

## Persistence Configuration

### Development
Uses RDB snapshots (default):
```conf
save 900 1      # Save after 900 seconds if 1 key changed
save 300 10     # Save after 300 seconds if 10 keys changed
save 60 10000   # Save after 60 seconds if 10000 keys changed
```

### Production
Use AOF (Append-Only File) for durability:
```conf
appendonly yes
appendfsync everysec
```

**Trade-offs:**
- RDB: Faster, smaller file, data loss possible on crash
- AOF: Slower, larger file, minimal data loss

## Cache Invalidation Strategies

### Time-Based (TTL)
Most caches use TTL for automatic expiration:
```typescript
await cacheUtils.set('key', value, 300); // 5 minutes
```

### Event-Based
Invalidate cache on data changes:
```typescript
// After updating tenant
await cacheUtils.delPattern(`tenant:${tenantId}*`);

// After posting journal entry
await cacheUtils.delPattern(`cache:report:*:${tenantId}:*`);

// After modifying accounts
await cacheUtils.del(`cache:account_tree:${tenantId}`);
```

### Cache-Aside Pattern
```typescript
// Try cache first
let data = await cacheUtils.get<ReportData>(cacheKey);

if (!data) {
  // Cache miss - fetch from database
  data = await generateReport(params);
  
  // Store in cache
  await cacheUtils.set(cacheKey, data, TTL);
}

return data;
```

## Troubleshooting

### Redis Connection Failures

**Symptom:** `ECONNREFUSED` or `Connection timeout`

**Solutions:**
1. Verify Redis is running: `redis-cli ping`
2. Check REDIS_URL environment variable
3. Verify network connectivity and firewall rules
4. Check Redis server logs

### High Memory Usage

**Symptom:** Redis memory exceeds allocated

**Solutions:**
1. Review key TTLs (ensure all keys expire)
2. Implement eviction policy: `maxmemory-policy allkeys-lru`
3. Increase Redis instance size
4. Reduce cache TTLs for large objects

### Slow Redis Commands

**Symptom:** Commands taking >10ms

**Solutions:**
1. Avoid `KEYS` command in production (use `SCAN` instead)
2. Use pipelining for multiple commands
3. Check for large values (>1MB)
4. Monitor `slowlog`

**View slow queries:**
```bash
redis-cli slowlog get 10
```

### Cache Stampede

**Symptom:** Multiple requests regenerating same cache simultaneously

**Solution:** Use Redis distributed locking:
```typescript
const lockKey = `lock:${cacheKey}`;
const acquired = await redis.set(lockKey, '1', 'EX', 10, 'NX');

if (acquired) {
  try {
    // Generate cache
    const data = await generateExpensiveData();
    await cacheUtils.set(cacheKey, data, TTL);
  } finally {
    await redis.del(lockKey);
  }
} else {
  // Wait and retry
  await new Promise(r => setTimeout(r, 100));
  return getData(); // Recursive retry
}
```

## Security Best Practices

1. **Use TLS/SSL in production:** `rediss://` protocol
2. **Enable authentication:** Set `requirepass` in redis.conf
3. **Network isolation:** Place Redis in private subnet
4. **Disable dangerous commands:** `rename-command FLUSHALL ""`
5. **Regular backups:** Automate RDB/AOF backups
6. **Limit connections:** Set `maxclients` appropriately
7. **Firewall rules:** Only allow access from app servers

## Production Checklist

- [ ] Set `REDIS_URL` environment variable
- [ ] Enable TLS/SSL (`rediss://`)
- [ ] Configure authentication token
- [ ] Set up Redis cluster/replication for high availability
- [ ] Enable persistence (AOF for production)
- [ ] Configure memory limits and eviction policy
- [ ] Set up monitoring and alerting
- [ ] Document cache invalidation strategy
- [ ] Test failover scenarios
- [ ] Configure backups and disaster recovery
- [ ] Review security settings (firewall, private subnet)
- [ ] Load test cache performance under production load

## Migration from In-Memory to Redis

When migrating existing in-memory caches to Redis:

1. **Keep both implementations initially** (dual-write)
2. **Compare cache hit rates** between implementations
3. **Monitor latency impact** (Redis adds network overhead)
4. **Gradually shift traffic** using feature flags
5. **Remove in-memory cache** once Redis is proven stable
