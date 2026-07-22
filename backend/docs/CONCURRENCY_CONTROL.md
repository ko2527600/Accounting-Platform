# Concurrency Control & Race Condition Prevention

## Overview
This document describes how the accounting platform prevents race conditions and ensures data consistency under concurrent operations.

## Critical Sections

### 1. Ledger Posting Race Condition

#### The Problem
When multiple journal entries are posted concurrently to the same account, a race condition can occur:

```
Time | Request A                  | Request B                  | Expected Balance
-----|----------------------------|----------------------------|------------------
T0   | Read balance: 1000.00      |                            |
T1   |                            | Read balance: 1000.00      |
T2   | Calculate: 1000 + 100      |                            |
T3   |                            | Calculate: 1000 + 200      |
T4   | Write balance: 1100.00     |                            |
T5   |                            | Write balance: 1200.00     |
     | RESULT: Balance = 1200.00 (should be 1300.00) ❌
```

#### The Solution
We use **PostgreSQL row-level locking** with `SELECT FOR UPDATE` to ensure serializable access:

```typescript
// Lock the latest balance row for this account
const lastLedgers = await prisma.$queryRawUnsafe(
  `SELECT balance 
   FROM ledgers 
   WHERE account_id = $1::uuid 
   ORDER BY transaction_date DESC, created_at DESC 
   LIMIT 1 
   FOR UPDATE`,  // ← This locks the row
  line.accountId
);
```

**What happens now:**
```
Time | Request A                     | Request B                     | Result
-----|-------------------------------|-------------------------------|--------
T0   | Read + LOCK balance: 1000.00  |                               |
T1   |                               | Read balance: (BLOCKED)       |
T2   | Calculate: 1000 + 100         |                               |
T3   | Write balance: 1100.00        |                               |
T4   | COMMIT (releases lock)        |                               |
T5   |                               | Read balance: 1100.00         |
T6   |                               | Calculate: 1100 + 200         |
T7   |                               | Write balance: 1300.00        |
     | RESULT: Balance = 1300.00 (correct) ✅
```

### 2. Transaction Isolation Level

We set `SERIALIZABLE` isolation level for ledger operations:

```sql
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
```

This provides the strongest isolation guarantee in PostgreSQL.

#### Isolation Levels Comparison

| Level | Read Uncommitted | Read Committed | Repeatable Read | Serializable |
|-------|------------------|----------------|-----------------|--------------|
| **Dirty Reads** | Possible | ❌ | ❌ | ❌ |
| **Non-repeatable Reads** | Possible | Possible | ❌ | ❌ |
| **Phantom Reads** | Possible | Possible | Possible | ❌ |
| **Serialization Anomalies** | Possible | Possible | Possible | ❌ |

**We use SERIALIZABLE** to prevent all concurrency anomalies in financial data.

### 3. Tenant Schema Isolation

The `withTenantDb()` function uses Prisma's interactive `$transaction` API:

```typescript
export async function withTenantDb<T>(
  prismaClient: PrismaClient,
  rawSchemaName: string,
  queryFn: (client: PrismaClient) => Promise<T>
): Promise<T> {
  return await prismaClient.$transaction(async (tx) => {
    const client = tx as unknown as PrismaClient;
    await client.$executeRawUnsafe(`SET LOCAL search_path TO "${schemaName}", public;`);
    return await queryFn(client);
  });
}
```

**Benefits:**
- All operations pin to **single database connection**
- `SET LOCAL` is transaction-scoped (auto-resets on commit/rollback)
- Prevents connection pool races
- Tenant isolation guaranteed

## Retry Logic

### Serialization Failures

When using SERIALIZABLE isolation, PostgreSQL may abort transactions with:
```
ERROR: could not serialize access due to concurrent update
```

**Handling strategy:**
```typescript
async function postWithRetry(journalEntryId: string, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await postJournalEntry(journalEntryId);
    } catch (error: any) {
      if (error.code === '40001' && attempt < maxRetries) {
        // Serialization failure - retry with exponential backoff
        const delay = Math.pow(2, attempt) * 100; // 200ms, 400ms, 800ms
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
}
```

**Note:** This is handled at the application layer, not in the repository.

## Other Critical Sections

### 1. Tenant Creation
**Protected by:** Unique constraint on `tenants.slug` and `tenants.schema`
```sql
CREATE UNIQUE INDEX ON tenants(slug);
CREATE UNIQUE INDEX ON tenants(schema);
```

### 2. Account Code Uniqueness
**Protected by:** Unique constraint on `accounts.code` per tenant schema
```sql
CREATE UNIQUE INDEX ON accounts(code);
```

### 3. Journal Entry Number Uniqueness
**Protected by:** Unique constraint on `journal_entries.entry_number` per tenant
```sql
CREATE UNIQUE INDEX ON journal_entries(entry_number);
```

## Performance Considerations

### Lock Contention
- **Impact:** If many journal entries post to the same account simultaneously, requests will queue
- **Mitigation:** Design accounts with granularity in mind (avoid "mega accounts")
- **Monitoring:** Track `pg_stat_activity` for blocked queries

### Deadlock Prevention
PostgreSQL automatically detects deadlocks and aborts one transaction.

**Our prevention strategy:**
1. Always lock accounts in **consistent order** (sorted by account_id)
2. Keep transactions **short-lived**
3. Avoid long-running operations inside transactions

### Query to Monitor Blocked Connections
```sql
SELECT 
  blocked_locks.pid AS blocked_pid,
  blocked_activity.usename AS blocked_user,
  blocking_locks.pid AS blocking_pid,
  blocking_activity.usename AS blocking_user,
  blocked_activity.query AS blocked_statement,
  blocking_activity.query AS blocking_statement
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks ON blocking_locks.locktype = blocked_locks.locktype
  AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
  AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
  AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
  AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
  AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
  AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
  AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
  AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
  AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
  AND blocking_locks.pid != blocked_locks.pid
JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;
```

## Testing Concurrency

### Load Test Script
```bash
# Simulate 10 concurrent posts to the same account
for i in {1..10}; do
  curl -X POST http://localhost:4000/api/v1/journal-entries \
    -H "Content-Type: application/json" \
    -H "X-Tenant-ID: tenant-123" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{
      "lines": [
        {"accountId": "same-account-id", "debit": 100, "credit": 0},
        {"accountId": "other-account-id", "debit": 0, "credit": 100}
      ],
      "status": "POSTED"
    }' &
done
wait

# Verify final balance is correct (should be 1000.00 if starting from 0)
```

### Expected Results
- All 10 requests succeed (some may retry on serialization failure)
- Final account balance is mathematically correct
- No lost updates or race conditions

## Production Checklist

- [ ] Verify `SERIALIZABLE` isolation level is set for ledger operations
- [ ] Confirm `SELECT FOR UPDATE` is used for balance lookups
- [ ] Test concurrent posting with load testing tools
- [ ] Monitor `pg_locks` for excessive lock contention
- [ ] Set up alerting for deadlock detection
- [ ] Document retry logic for serialization failures
- [ ] Review account design to minimize lock contention
- [ ] Configure statement_timeout to prevent lock queuing
