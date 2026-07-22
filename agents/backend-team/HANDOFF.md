# Backend Handoff Contract for Frontend Team

This document is updated by the **Backend Team** whenever a backend service/endpoint is implemented, tested, and ready for consumption by the **Frontend Team**.

---

## 🟢 Available Services & APIs

### Endpoint: `GET /health` (or `GET /api/v1/health`)
- **Description**: Microservice health check endpoint to verify backend server operational status.
- **Headers Required**: None
- **Request Payload**: None
- **Success Response (200 OK)**:
  ```json
  {
    "status": "ok",
    "timestamp": "2026-07-21T12:21:24.079Z",
    "service": "backend-api"
  }
  ```
- **Verification Command**:
  ```bash
  curl -X GET http://localhost:4000/health
  ```

---

### Endpoint: `POST /api/v1/admin/migrations/run`
- **Description**: Triggers dynamic tenant database schema migrations (creates schemas and runs DDL migrations for tenant core tables).
- **Headers Required**:
  ```http
  Content-Type: application/json
  ```
- **Request Payload**:
  ```json
  {
    "tenantSchema": "acme_corp"
  }
  ```
  *(Or `{ "allTenants": true }` to run migrations across all registered tenants)*
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Migrations applied successfully for schema tenant_acme_corp",
    "data": {
      "tenantId": "tenant-uuid-or-slug",
      "schemaName": "tenant_acme_corp",
      "appliedMigrations": [
        "001_initial_tenant_core_schema"
      ],
      "skippedCount": 0
    }
  }
  ```
- **Verification Command**:
  ```bash
  curl -X POST http://localhost:4000/api/v1/admin/migrations/run -H "Content-Type: application/json" -d '{"tenantSchema": "acme_corp"}'
  ```

---

### 🛡️ Multi-Tenant Request Contract (Middleware Utility)
- **Tenant Context Requirement**: All multi-tenant endpoints require tenant identity in request headers (`X-Tenant-ID`, `X-Tenant-Slug`, or `X-Tenant-Schema`) or authenticated JWT context (`req.user.tenantId`).
- **Required Header**: `X-Tenant-ID` (or `X-Tenant-Slug` or `X-Tenant-Schema`).
- **Behavior & Strict Verification (BE-110)**:
  - `tenantContextMiddleware` extracts tenant identifier from request headers (`X-Tenant-ID`, `X-Tenant-Slug`, `X-Tenant-Schema`) or JWT context.
  - Verifies registration in `public.tenants` table (`prisma.tenant.findFirst`). Returns `404 Not Found` (`"Tenant Not Found"`, message: `Tenant with identifier "..." is not registered.`) if identifier is not registered.
  - Performs automatic schema existence check & auto-migration provisioning (`ensureTenantSchemaMigrated`), automatically creating PostgreSQL tenant schema (`tenant_<slug>`) and running initial DDL migrations if unprovisioned.
  - Propagates strict `AsyncLocalStorage` context (`tenantId`, `tenantSchema`, `tenantName`, `tenantSlug`) for downstream service and database operations.
  - Database queries execute automatically within PostgreSQL schema search path (`SET search_path TO "tenant_<slug>", public`).
  - Returns `400 Bad Request` (`"Missing Tenant Identifier"`) if mandatory tenant header is omitted on protected endpoints.


---

### 🔑 Authentication & Authorization APIs

#### Endpoint: `POST /api/v1/auth/register`
- **Description**: Registers a new user with password hashing (PBKDF2 SHA-512) and returns JWT authentication token.
- **Headers Required**:
  ```http
  Content-Type: application/json
  ```
- **Request Payload**:
  ```json
  {
    "email": "user@example.com",
    "password": "securePassword123!",
    "name": "John Doe",
    "role": "Admin",
    "tenantId": "optional-tenant-id-or-slug"
  }
  ```
  *(Supported Roles: `"Admin"`, `"Accountant"`, `"Auditor"`, `"Viewer"`. Default: `"Viewer"`)*
- **Success Response (201 Created)**:
  ```json
  {
    "success": true,
    "message": "User registered successfully",
    "data": {
      "user": {
        "id": "c1f7a01d-...",
        "email": "user@example.com",
        "name": "John Doe",
        "role": "Admin",
        "tenantId": "optional-tenant-id-or-slug",
        "createdAt": "2026-07-21T12:50:00.000Z"
      },
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
  }
  ```
- **Verification Command**:
  ```bash
  curl -X POST http://localhost:4000/api/v1/auth/register -H "Content-Type: application/json" -d '{"email":"user@example.com","password":"securePassword123!","name":"John Doe","role":"Admin"}'
  ```

#### Endpoint: `POST /api/v1/auth/login`
- **Description**: Authenticates user credentials and generates JWT token.
- **Headers Required**:
  ```http
  Content-Type: application/json
  ```
- **Request Payload**:
  ```json
  {
    "email": "user@example.com",
    "password": "securePassword123!"
  }
  ```
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Login successful",
    "data": {
      "user": {
        "id": "c1f7a01d-...",
        "email": "user@example.com",
        "name": "John Doe",
        "role": "Admin",
        "tenantId": "optional-tenant-id-or-slug",
        "createdAt": "2026-07-21T12:50:00.000Z"
      },
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
  }
  ```
- **Verification Command**:
  ```bash
  curl -X POST http://localhost:4000/api/v1/auth/login -H "Content-Type: application/json" -d '{"email":"user@example.com","password":"securePassword123!"}'
  ```

#### Endpoint: `GET /api/v1/auth/me`
- **Description**: Retrieves current authenticated user's profile details.
- **Headers Required**:
  ```http
  Authorization: Bearer <jwt_token>
  ```
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "user": {
        "id": "c1f7a01d-...",
        "email": "user@example.com",
        "name": "John Doe",
        "role": "Admin",
        "tenantId": "optional-tenant-id-or-slug",
        "createdAt": "2026-07-21T12:50:00.000Z"
      }
    }
  }
  ```
- **Verification Command**:
  ```bash
  curl -X GET http://localhost:4000/api/v1/auth/me -H "Authorization: Bearer <jwt_token>"
  ```

#### Endpoint: `POST /api/v1/auth/verify`
- **Description**: Verifies JWT token validity and returns claims payload.
- **Headers Required**:
  ```http
  Authorization: Bearer <jwt_token>
  ```
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "valid": true,
    "data": {
      "user": {
        "id": "c1f7a01d-...",
        "email": "user@example.com",
        "role": "Admin",
        "iat": 1784638200,
        "exp": 1784724600
      }
    }
  }
  ```
- **Verification Command**:
  ```bash
  curl -X POST http://localhost:4000/api/v1/auth/verify -H "Authorization: Bearer <jwt_token>"
  ```

---

### 🏢 Tenant Onboarding API

#### Endpoint: `POST /api/v1/tenants/onboard`
- **Description**: Registers a new tenant in `public.tenants`, provisions dedicated PostgreSQL schema (`tenant_<slug>`), executes core DDL migrations (`001_initial_tenant_core_schema`), registers the tenant Admin user in `public.users`, and returns tenant details + Admin JWT authentication token.
- **Headers Required**:
  ```http
  Content-Type: application/json
  ```
- **Request Payload**:
  ```json
  {
    "companyName": "Acme Accounting Ltd",
    "slug": "acme-acc",
    "adminEmail": "admin@acme.com",
    "adminPassword": "Password123!",
    "adminName": "Acme Admin"
  }
  ```
  *(Note: `slug` is optional and auto-generated from `companyName` if omitted. `adminName` falls back to company name + "Admin" if omitted)*
- **Success Response (201 Created)**:
  ```json
  {
    "success": true,
    "message": "Tenant onboarded successfully",
    "data": {
      "tenant": {
        "id": "e4f8a01d-5b23-4c91-a123-9876543210ab",
        "name": "Acme Accounting Ltd",
        "slug": "acme-acc",
        "schema": "tenant_acme_acc",
        "createdAt": "2026-07-21T13:00:00.000Z"
      },
      "admin": {
        "id": "f5a7b02c-6c34-5d82-b234-8765432109bc",
        "email": "admin@acme.com",
        "name": "Acme Admin",
        "role": "Admin",
        "tenantId": "e4f8a01d-5b23-4c91-a123-9876543210ab",
        "createdAt": "2026-07-21T13:00:00.000Z"
      },
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "migration": {
        "appliedMigrations": [
          "001_initial_tenant_core_schema"
        ]
      }
    }
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: Validation error (missing company name, invalid email, password too short).
  - `409 Conflict`: Tenant slug or Admin email already registered.
  - `500 Internal Server Error`: Schema provisioning or database error.
- **Verification Command**:
  ```bash
  curl -X POST http://localhost:4000/api/v1/tenants/onboard -H "Content-Type: application/json" -d '{"companyName":"Acme Accounting Ltd","slug":"acme-acc","adminEmail":"admin@acme.com","adminPassword":"Password123!","adminName":"Acme Admin"}'
  ```

#### Endpoint: `GET /api/v1/tenants`
- **Description**: Retrieves a list of all registered tenants.
- **Headers Required**: None
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "tenants": [
        {
          "id": "e4f8a01d-...",
          "name": "Acme Accounting Ltd",
          "slug": "acme-acc",
          "schema": "tenant_acme_acc",
          "createdAt": "2026-07-21T13:00:00.000Z",
          "updatedAt": "2026-07-21T13:00:00.000Z"
        }
      ]
    }
  }
  ```
- **Verification Command**:
  ```bash
  curl -X GET http://localhost:4000/api/v1/tenants
  ```

---

### 📊 Core Accounting Database Schema & Repositories (BE-105)

- **Description**: Database models, migration DDLs, and repositories for Chart of Accounts, Journal Entries, Journal Entry Lines, and Ledgers with strict SQL check constraints and double-entry balance triggers.

#### Database Enums
- **`AccountType`**: `'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'`
- **`JournalEntryStatus`**: `'DRAFT' | 'POSTED' | 'VOID'`

#### Core Tables & Constraints (Tenant Schema `tenant_<slug>`)
1. **`accounts`**:
   - `id` (UUID PK, default `gen_random_uuid()`)
   - `code` (VARCHAR(50) UNIQUE)
   - `name` (VARCHAR(255))
   - `type` (VARCHAR(50), `CONSTRAINT chk_account_type CHECK (type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'))`)
   - `parent_id` (UUID FK -> `accounts(id)` ON DELETE SET NULL)
   - `currency` (VARCHAR(10), default `'USD'`)
   - `is_active` (BOOLEAN, default `true`)
   - `created_at`, `updated_at` (TIMESTAMPTZ)

2. **`journal_entries`**:
   - `id` (UUID PK, default `gen_random_uuid()`)
   - `entry_number` (VARCHAR(100) UNIQUE)
   - `entry_date` (DATE)
   - `description` (TEXT)
   - `status` (VARCHAR(20), `CONSTRAINT chk_journal_entry_status CHECK (status IN ('DRAFT', 'POSTED', 'VOID'))`)
   - `created_at`, `updated_at` (TIMESTAMPTZ)

3. **`journal_entry_lines`**:
   - `id` (UUID PK, default `gen_random_uuid()`)
   - `journal_entry_id` (UUID FK -> `journal_entries(id)` ON DELETE CASCADE)
   - `account_id` (UUID FK -> `accounts(id)` ON DELETE RESTRICT)
   - `debit` (NUMERIC(15,2), `CONSTRAINT chk_line_debit_non_negative CHECK (debit >= 0)`)
   - `credit` (NUMERIC(15,2), `CONSTRAINT chk_line_credit_non_negative CHECK (credit >= 0)`)
   - `description` (TEXT)
   - `created_at` (TIMESTAMPTZ)

4. **`ledgers`**:
   - `id` (UUID PK, default `gen_random_uuid()`)
   - `account_id` (UUID FK -> `accounts(id)` ON DELETE RESTRICT)
   - `transaction_date` (DATE)
   - `journal_entry_id` (UUID FK -> `journal_entries(id)` ON DELETE SET NULL)
   - `debit` (NUMERIC(15,2), `CONSTRAINT chk_ledger_debit_non_negative CHECK (debit >= 0)`)
   - `credit` (NUMERIC(15,2), `CONSTRAINT chk_ledger_credit_non_negative CHECK (credit >= 0)`)
   - `balance` (NUMERIC(15,2))
   - `description` (TEXT)
   - `created_at` (TIMESTAMPTZ)

#### Database Triggers
- **`trg_check_journal_entry_balance`**: Triggers function `check_journal_entry_double_entry_balance()` on `journal_entries` and `journal_entry_lines`. When status is `'POSTED'`, enforces that `SUM(debit) == SUM(credit)` and `SUM(debit) > 0`, throwing a PostgreSQL exception if unbalanced.

#### Available Repositories
- **`accountRepository.ts`**: `createAccount`, `getAccountById`, `getAccountByCode`, `listAccounts`, `updateAccount`, `deleteAccount`
- **`journalEntryRepository.ts`**: `createJournalEntry`, `getJournalEntryById`, `listJournalEntries`, `updateJournalEntryStatus`, `deleteJournalEntry`
- **`ledgerRepository.ts`**: `createLedgerEntry`, `getLedgerByAccountId`, `postJournalEntryToLedger`

---

### 📊 Chart of Accounts CRUD APIs (BE-106)

#### Endpoint: `POST /api/v1/accounts`
- **Description**: Creates a new account in the Chart of Accounts for the active tenant.
- **Headers Required**:
  ```http
  Authorization: Bearer <jwt_token>
  X-Tenant-ID: <tenant_id_or_slug>
  Content-Type: application/json
  ```
  *(Supported Roles: `"Admin"`, `"Accountant"`)*
- **Request Payload**:
  ```json
  {
    "code": "1000",
    "name": "Assets",
    "type": "ASSET",
    "parentId": null,
    "currency": "USD",
    "isActive": true
  }
  ```
  *(Account Types supported: `"ASSET"`, `"LIABILITY"`, `"EQUITY"`, `"REVENUE"`, `"EXPENSE"`)*
- **Success Response (201 Created)**:
  ```json
  {
    "success": true,
    "message": "Account created successfully",
    "data": {
      "account": {
        "id": "e4f8a01d-5b23-4c91-a123-9876543210ab",
        "code": "1000",
        "name": "Assets",
        "type": "ASSET",
        "parentId": null,
        "currency": "USD",
        "isActive": true,
        "createdAt": "2026-07-21T13:00:00.000Z",
        "updatedAt": "2026-07-21T13:00:00.000Z"
      }
    }
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: Missing code/name, invalid account type, or parentId does not exist.
  - `401 Unauthorized`: Missing or invalid JWT token.
  - `403 Forbidden`: Insufficient role permissions.
  - `409 Conflict`: Account code already exists for active tenant.
- **Verification Command**:
  ```bash
  curl -X POST http://localhost:4000/api/v1/accounts -H "Authorization: Bearer <jwt_token>" -H "X-Tenant-ID: acme-acc" -H "Content-Type: application/json" -d '{"code":"1000","name":"Assets","type":"ASSET"}'
  ```

#### Endpoint: `GET /api/v1/accounts`
- **Description**: Retrieves all accounts for the active tenant as a flat list and nested tree hierarchy.
- **Headers Required**:
  ```http
  Authorization: Bearer <jwt_token>
  X-Tenant-ID: <tenant_id_or_slug>
  ```
  *(Supported Roles: `"Admin"`, `"Accountant"`, `"Auditor"`, `"Viewer"`)*
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "accounts": [
        {
          "id": "e4f8a01d-...",
          "code": "1000",
          "name": "Assets",
          "type": "ASSET",
          "parentId": null,
          "currency": "USD",
          "isActive": true,
          "createdAt": "2026-07-21T13:00:00.000Z",
          "updatedAt": "2026-07-21T13:00:00.000Z"
        },
        {
          "id": "f5a7b02c-...",
          "code": "1100",
          "name": "Current Assets",
          "type": "ASSET",
          "parentId": "e4f8a01d-...",
          "currency": "USD",
          "isActive": true,
          "createdAt": "2026-07-21T13:05:00.000Z",
          "updatedAt": "2026-07-21T13:05:00.000Z"
        }
      ],
      "tree": [
        {
          "id": "e4f8a01d-...",
          "code": "1000",
          "name": "Assets",
          "type": "ASSET",
          "parentId": null,
          "currency": "USD",
          "isActive": true,
          "createdAt": "2026-07-21T13:00:00.000Z",
          "updatedAt": "2026-07-21T13:00:00.000Z",
          "children": [
            {
              "id": "f5a7b02c-...",
              "code": "1100",
              "name": "Current Assets",
              "type": "ASSET",
              "parentId": "e4f8a01d-...",
              "currency": "USD",
              "isActive": true,
              "createdAt": "2026-07-21T13:05:00.000Z",
              "updatedAt": "2026-07-21T13:05:00.000Z",
              "children": []
            }
          ]
        }
      ]
    }
  }
  ```
- **Verification Command**:
  ```bash
  curl -X GET http://localhost:4000/api/v1/accounts -H "Authorization: Bearer <jwt_token>" -H "X-Tenant-ID: acme-acc"
  ```

#### Endpoint: `GET /api/v1/accounts/:id`
- **Description**: Retrieves single account details by account UUID.
- **Headers Required**:
  ```http
  Authorization: Bearer <jwt_token>
  X-Tenant-ID: <tenant_id_or_slug>
  ```
  *(Supported Roles: `"Admin"`, `"Accountant"`, `"Auditor"`, `"Viewer"`)*
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "account": {
        "id": "e4f8a01d-...",
        "code": "1000",
        "name": "Assets",
        "type": "ASSET",
        "parentId": null,
        "currency": "USD",
        "isActive": true,
        "createdAt": "2026-07-21T13:00:00.000Z",
        "updatedAt": "2026-07-21T13:00:00.000Z"
      }
    }
  }
  ```
- **Error Responses**:
  - `404 Not Found`: Account ID not found.
- **Verification Command**:
  ```bash
  curl -X GET http://localhost:4000/api/v1/accounts/<account_id> -H "Authorization: Bearer <jwt_token>" -H "X-Tenant-ID: acme-acc"
  ```

#### Endpoint: `PUT /api/v1/accounts/:id`
- **Description**: Updates an existing account's details (code, name, type, parentId, currency, isActive).
- **Headers Required**:
  ```http
  Authorization: Bearer <jwt_token>
  X-Tenant-ID: <tenant_id_or_slug>
  Content-Type: application/json
  ```
  *(Supported Roles: `"Admin"`, `"Accountant"`)*
- **Request Payload**:
  ```json
  {
    "name": "Updated Assets Name",
    "isActive": true
  }
  ```
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Account updated successfully",
    "data": {
      "account": {
        "id": "e4f8a01d-...",
        "code": "1000",
        "name": "Updated Assets Name",
        "type": "ASSET",
        "parentId": null,
        "currency": "USD",
        "isActive": true,
        "createdAt": "2026-07-21T13:00:00.000Z",
        "updatedAt": "2026-07-21T13:10:00.000Z"
      }
    }
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: Self-parent assignment or circular parent reference detected.
  - `404 Not Found`: Account ID not found.
  - `409 Conflict`: Code updated to an already existing code.
- **Verification Command**:
  ```bash
  curl -X PUT http://localhost:4000/api/v1/accounts/<account_id> -H "Authorization: Bearer <jwt_token>" -H "X-Tenant-ID: acme-acc" -H "Content-Type: application/json" -d '{"name":"Updated Assets Name"}'
  ```

#### Endpoint: `DELETE /api/v1/accounts/:id`
- **Description**: Deletes an account from active tenant Chart of Accounts.
- **Headers Required**:
  ```http
  Authorization: Bearer <jwt_token>
  X-Tenant-ID: <tenant_id_or_slug>
  ```
  *(Supported Roles: `"Admin"`, `"Accountant"`)*
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Account deleted successfully"
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: Account has child accounts or is referenced in posted journal entries/ledgers.
  - `404 Not Found`: Account ID not found.
- **Verification Command**:
  ```bash
  curl -X DELETE http://localhost:4000/api/v1/accounts/<account_id> -H "Authorization: Bearer <jwt_token>" -H "X-Tenant-ID: acme-acc"
  ```

---

### 📖 Journal Entries APIs (BE-107)

#### Endpoint: `POST /api/v1/journal-entries`
- **Description**: Creates a new journal entry (Draft or Posted) with line items for the active tenant. Enforces double-entry balancing validation (`SUM debit == SUM credit`), minimum 2 lines requirement, non-negative amounts, and account ID existence in active tenant schema.
- **Headers Required**:
  ```http
  Authorization: Bearer <jwt_token>
  X-Tenant-ID: <tenant_id_or_slug>
  Content-Type: application/json
  ```
  *(Supported Roles: `"Admin"`, `"Accountant"`)*
- **Request Payload**:
  ```json
  {
    "entryNumber": "JE-2026-001",
    "entryDate": "2026-07-21",
    "description": "Sales Invoice #1001",
    "status": "DRAFT",
    "lines": [
      {
        "accountId": "e4f8a01d-5b23-4c91-a123-9876543210ab",
        "debit": 1500.00,
        "credit": 0.00,
        "description": "Cash received"
      },
      {
        "accountId": "f5a7b02c-6c34-5d82-b234-8765432109bc",
        "debit": 0.00,
        "credit": 1500.00,
        "description": "Sales revenue"
      }
    ]
  }
  ```
  *(Note: `entryNumber` is optional and auto-generated if omitted. `status` defaults to `"DRAFT"`. If created with `"POSTED"`, ledger records are generated automatically)*
- **Success Response (201 Created)**:
  ```json
  {
    "success": true,
    "message": "Journal entry created successfully",
    "data": {
      "journalEntry": {
        "id": "a1b2c3d4-...",
        "entryNumber": "JE-2026-001",
        "entryDate": "2026-07-21T00:00:00.000Z",
        "description": "Sales Invoice #1001",
        "status": "DRAFT",
        "createdAt": "2026-07-21T13:45:00.000Z",
        "updatedAt": "2026-07-21T13:45:00.000Z",
        "lines": [
          {
            "id": "line-1-uuid",
            "journalEntryId": "a1b2c3d4-...",
            "accountId": "e4f8a01d-...",
            "debit": 1500.00,
            "credit": 0.00,
            "description": "Cash received",
            "createdAt": "2026-07-21T13:45:00.000Z"
          },
          {
            "id": "line-2-uuid",
            "journalEntryId": "a1b2c3d4-...",
            "accountId": "f5a7b02c-...",
            "debit": 0.00,
            "credit": 1500.00,
            "description": "Sales revenue",
            "createdAt": "2026-07-21T13:45:00.000Z"
          }
        ]
      }
    }
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: Unbalanced debits/credits, fewer than 2 lines, invalid line numbers/amounts, or non-existent accountId.
  - `401 Unauthorized`: Missing or invalid JWT token.
  - `403 Forbidden`: Insufficient permissions (Viewer role).
  - `409 Conflict`: Journal entry number already exists.
- **Verification Command**:
  ```bash
  curl -X POST http://localhost:4000/api/v1/journal-entries -H "Authorization: Bearer <jwt_token>" -H "X-Tenant-ID: acme-acc" -H "Content-Type: application/json" -d '{"entryNumber":"JE-2026-001","lines":[{"accountId":"<cash_acc_id>","debit":100,"credit":0},{"accountId":"<rev_acc_id>","debit":0,"credit":100}]}'
  ```

#### Endpoint: `GET /api/v1/journal-entries`
- **Description**: Retrieves list of all journal entries for the active tenant with optional filtering by status, date range, or entryNumber/description search.
- **Headers Required**:
  ```http
  Authorization: Bearer <jwt_token>
  X-Tenant-ID: <tenant_id_or_slug>
  ```
  *(Supported Roles: `"Admin"`, `"Accountant"`, `"Auditor"`, `"Viewer"`)*
- **Query Parameters**:
  - `status`: Filter by status (`DRAFT`, `POSTED`, `VOID`)
  - `startDate`: Filter entries on or after date (`YYYY-MM-DD`)
  - `endDate`: Filter entries on or before date (`YYYY-MM-DD`)
  - `search`: Case-insensitive search on `entry_number` or `description`
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "journalEntries": [
        {
          "id": "a1b2c3d4-...",
          "entryNumber": "JE-2026-001",
          "entryDate": "2026-07-21T00:00:00.000Z",
          "description": "Sales Invoice #1001",
          "status": "DRAFT",
          "createdAt": "2026-07-21T13:45:00.000Z",
          "updatedAt": "2026-07-21T13:45:00.000Z",
          "lines": [...]
        }
      ]
    }
  }
  ```
- **Verification Command**:
  ```bash
  curl -X GET "http://localhost:4000/api/v1/journal-entries?status=POSTED" -H "Authorization: Bearer <jwt_token>" -H "X-Tenant-ID: acme-acc"
  ```

#### Endpoint: `GET /api/v1/journal-entries/:id`
- **Description**: Retrieves single journal entry details with line items by journal entry UUID.
- **Headers Required**:
  ```http
  Authorization: Bearer <jwt_token>
  X-Tenant-ID: <tenant_id_or_slug>
  ```
  *(Supported Roles: `"Admin"`, `"Accountant"`, `"Auditor"`, `"Viewer"`)*
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "journalEntry": {
        "id": "a1b2c3d4-...",
        "entryNumber": "JE-2026-001",
        "entryDate": "2026-07-21T00:00:00.000Z",
        "description": "Sales Invoice #1001",
        "status": "DRAFT",
        "createdAt": "2026-07-21T13:45:00.000Z",
        "updatedAt": "2026-07-21T13:45:00.000Z",
        "lines": [...]
      }
    }
  }
  ```
- **Error Responses**:
  - `404 Not Found`: Journal Entry ID not found.
- **Verification Command**:
  ```bash
  curl -X GET http://localhost:4000/api/v1/journal-entries/<entry_id> -H "Authorization: Bearer <jwt_token>" -H "X-Tenant-ID: acme-acc"
  ```

#### Endpoint: `POST /api/v1/journal-entries/:id/post`
- **Description**: Posts a draft journal entry to the general ledger, updating status to `"POSTED"` and generating ledger transaction records for all line items.
- **Headers Required**:
  ```http
  Authorization: Bearer <jwt_token>
  X-Tenant-ID: <tenant_id_or_slug>
  ```
  *(Supported Roles: `"Admin"`, `"Accountant"`)*
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Journal entry posted successfully",
    "data": {
      "journalEntry": {
        "id": "a1b2c3d4-...",
        "entryNumber": "JE-2026-001",
        "status": "POSTED",
        "lines": [...]
      }
    }
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: Journal entry is already posted, or is voided, or unbalanced.
  - `404 Not Found`: Journal Entry ID not found.
- **Verification Command**:
  ```bash
  curl -X POST http://localhost:4000/api/v1/journal-entries/<entry_id>/post -H "Authorization: Bearer <jwt_token>" -H "X-Tenant-ID: acme-acc"
  ```

#### Endpoint: `POST /api/v1/journal-entries/:id/void`
- **Description**: Voids a journal entry, updating status to `"VOID"`.
- **Headers Required**:
  ```http
  Authorization: Bearer <jwt_token>
  X-Tenant-ID: <tenant_id_or_slug>
  ```
  *(Supported Roles: `"Admin"`, `"Accountant"`)*
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Journal entry voided successfully",
    "data": {
      "journalEntry": {
        "id": "a1b2c3d4-...",
        "entryNumber": "JE-2026-001",
        "status": "VOID",
        "lines": [...]
      }
    }
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: Journal entry is already voided.
  - `404 Not Found`: Journal Entry ID not found.
- **Verification Command**:
  ```bash
  curl -X POST http://localhost:4000/api/v1/journal-entries/<entry_id>/void -H "Authorization: Bearer <jwt_token>" -H "X-Tenant-ID: acme-acc"
  ```

---

### 📒 Ledger Accounts & Transaction History APIs (BE-108)

#### Endpoint: `GET /api/v1/ledgers`
- **Description**: Retrieves list of general ledger transactions across all accounts for active tenant with optional filtering by `accountId`, `startDate`, `endDate`, `search` term, and pagination parameters (`page`, `limit`).
- **Headers Required**:
  ```http
  Authorization: Bearer <jwt_token>
  X-Tenant-ID: <tenant_id_or_slug>
  ```
  *(Supported Roles: `"Admin"`, `"Accountant"`, `"Auditor"`, `"Viewer"`)*
- **Query Parameters**:
  - `accountId`: Filter transactions for a specific account UUID
  - `startDate`: Filter transactions on or after date (`YYYY-MM-DD`)
  - `endDate`: Filter transactions on or before date (`YYYY-MM-DD`)
  - `search`: Case-insensitive search on transaction description, entry number, or account code/name
  - `page`: Page number (default: `1`)
  - `limit`: Page limit (default: `20`, max: `100`)
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "transactions": [
        {
          "id": "l1f8a01d-...",
          "accountId": "e4f8a01d-...",
          "accountCode": "1010",
          "accountName": "Cash",
          "accountType": "ASSET",
          "transactionDate": "2026-07-21T00:00:00.000Z",
          "journalEntryId": "a1b2c3d4-...",
          "entryNumber": "JE-2026-001",
          "debit": 1500.00,
          "credit": 0.00,
          "balance": 1500.00,
          "description": "Cash received",
          "createdAt": "2026-07-21T13:45:00.000Z"
        }
      ],
      "pagination": {
        "total": 1,
        "page": 1,
        "limit": 20,
        "totalPages": 1
      }
    }
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: Invalid date format or parameter values.
  - `401 Unauthorized`: Missing or invalid JWT token.
  - `404 Not Found`: `accountId` filter provided but account does not exist.
- **Verification Command**:
  ```bash
  curl -X GET "http://localhost:4000/api/v1/ledgers?page=1&limit=20" -H "Authorization: Bearer <jwt_token>" -H "X-Tenant-ID: acme-acc"
  ```

#### Endpoint: `GET /api/v1/ledgers/accounts/:accountId`
- **Description**: Retrieves detailed ledger statement for a specific account, including account metadata, opening balance prior to `startDate`, debit/credit running totals, net change, closing balance, and chronological transaction history with running balances.
- **Headers Required**:
  ```http
  Authorization: Bearer <jwt_token>
  X-Tenant-ID: <tenant_id_or_slug>
  ```
  *(Supported Roles: `"Admin"`, `"Accountant"`, `"Auditor"`, `"Viewer"`)*
- **Query Parameters**:
  - `startDate`: Filter statement transactions starting on date (`YYYY-MM-DD`). Prior transactions calculate `openingBalance`.
  - `endDate`: Filter statement transactions up to date (`YYYY-MM-DD`).
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "account": {
        "id": "e4f8a01d-5b23-4c91-a123-9876543210ab",
        "code": "1010",
        "name": "Cash",
        "type": "ASSET",
        "currency": "USD"
      },
      "statement": {
        "startDate": "2026-07-01",
        "endDate": "2026-07-31",
        "openingBalance": 0.00,
        "totalDebit": 1500.00,
        "totalCredit": 350.00,
        "netChange": 1150.00,
        "closingBalance": 1150.00,
        "transactions": [
          {
            "id": "l1f8a01d-...",
            "accountId": "e4f8a01d-...",
            "accountCode": "1010",
            "accountName": "Cash",
            "accountType": "ASSET",
            "transactionDate": "2026-07-01T00:00:00.000Z",
            "journalEntryId": "a1b2c3d4-...",
            "entryNumber": "JE-2026-001",
            "debit": 1500.00,
            "credit": 0.00,
            "balance": 1500.00,
            "runningBalance": 1500.00,
            "description": "Cash deposit",
            "createdAt": "2026-07-01T10:00:00.000Z"
          },
          {
            "id": "l2f8a01d-...",
            "accountId": "e4f8a01d-...",
            "accountCode": "1010",
            "accountName": "Cash",
            "accountType": "ASSET",
            "transactionDate": "2026-07-15T00:00:00.000Z",
            "journalEntryId": "b2c3d4e5-...",
            "entryNumber": "JE-2026-002",
            "debit": 0.00,
            "credit": 350.00,
            "balance": 1150.00,
            "runningBalance": 1150.00,
            "description": "Stationery purchase",
            "createdAt": "2026-07-15T14:30:00.000Z"
          }
        ]
      }
    }
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: Invalid date format or parameter.
  - `404 Not Found`: Account ID not found.
- **Verification Command**:
  ```bash
  curl -X GET "http://localhost:4000/api/v1/ledgers/accounts/<account_id>?startDate=2026-07-01" -H "Authorization: Bearer <jwt_token>" -H "X-Tenant-ID: acme-acc"
  ```

#### Endpoint: `GET /api/v1/ledgers/summary`
- **Description**: Retrieves general ledger summary across all accounts in active tenant Chart of Accounts, providing opening balances, period total debits, period total credits, net change, closing balances for each account, and grand totals.
- **Headers Required**:
  ```http
  Authorization: Bearer <jwt_token>
  X-Tenant-ID: <tenant_id_or_slug>
  ```
  *(Supported Roles: `"Admin"`, `"Accountant"`, `"Auditor"`, `"Viewer"`)*
- **Query Parameters**:
  - `startDate`: Filter summary period starting on date (`YYYY-MM-DD`).
  - `endDate`: Filter summary period ending on date (`YYYY-MM-DD`).
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "startDate": "2026-07-01",
      "endDate": "2026-07-31",
      "accounts": [
        {
          "id": "e4f8a01d-...",
          "code": "1010",
          "name": "Cash",
          "type": "ASSET",
          "currency": "USD",
          "openingBalance": 0.00,
          "totalDebit": 1500.00,
          "totalCredit": 350.00,
          "netChange": 1150.00,
          "closingBalance": 1150.00
        },
        {
          "id": "f5a7b02c-...",
          "code": "4010",
          "name": "Sales Revenue",
          "type": "REVENUE",
          "currency": "USD",
          "openingBalance": 0.00,
          "totalDebit": 0.00,
          "totalCredit": 1500.00,
          "netChange": -1500.00,
          "closingBalance": -1500.00
        },
        {
          "id": "g6b8c03d-...",
          "code": "5010",
          "name": "Office Expense",
          "type": "EXPENSE",
          "currency": "USD",
          "openingBalance": 0.00,
          "totalDebit": 350.00,
          "totalCredit": 0.00,
          "netChange": 350.00,
          "closingBalance": 350.00
        }
      ],
      "totals": {
        "totalDebit": 1850.00,
        "totalCredit": 1850.00
      }
    }
  }
  ```
- **Verification Command**:
  ```bash
  curl -X GET "http://localhost:4000/api/v1/ledgers/summary?startDate=2026-07-01" -H "Authorization: Bearer <jwt_token>" -H "X-Tenant-ID: acme-acc"
  ```

---

### 📈 Financial Reporting APIs (BE-109)

#### Endpoint: `GET /api/v1/reports/trial-balance`
- **Description**: Retrieves Trial Balance report listing all accounts in tenant Chart of Accounts with their net Debit/Credit balances and verifies that grand total debits equal grand total credits (`isBalanced === true`).
- **Headers Required**:
  ```http
  Authorization: Bearer <jwt_token>
  X-Tenant-ID: <tenant_id_or_slug>
  ```
  *(Supported Roles: `"Admin"`, `"Accountant"`, `"Auditor"`, `"Viewer"`)*
- **Query Parameters**:
  - `asOfDate`: Filter transactions up to date (`YYYY-MM-DD`)
  - `startDate`: Filter transactions starting on or after date (`YYYY-MM-DD`)
  - `endDate`: Filter transactions on or before date (`YYYY-MM-DD`)
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "asOfDate": null,
      "startDate": "2026-07-01",
      "endDate": "2026-07-31",
      "accounts": [
        {
          "id": "e4f8a01d-...",
          "code": "1010",
          "name": "Cash & Bank",
          "type": "ASSET",
          "debit": 7500.00,
          "credit": 0.00
        },
        {
          "id": "f5a7b02c-...",
          "code": "4010",
          "name": "Consulting Revenue",
          "type": "REVENUE",
          "debit": 0.00,
          "credit": 3000.00
        }
      ],
      "totals": {
        "totalDebit": 8700.00,
        "totalCredit": 8700.00,
        "isBalanced": true
      }
    }
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: Invalid date format.
  - `401 Unauthorized`: Missing or invalid JWT token.
- **Verification Command**:
  ```bash
  curl -X GET "http://localhost:4000/api/v1/reports/trial-balance?startDate=2026-07-01&endDate=2026-07-31" -H "Authorization: Bearer <jwt_token>" -H "X-Tenant-ID: acme-acc"
  ```

#### Endpoint: `GET /api/v1/reports/profit-loss`
- **Description**: Retrieves Profit & Loss Statement calculating total Revenue, total Expenses, Net Profit/Loss, and profitability flag (`isProfit`) over a date range.
- **Headers Required**:
  ```http
  Authorization: Bearer <jwt_token>
  X-Tenant-ID: <tenant_id_or_slug>
  ```
  *(Supported Roles: `"Admin"`, `"Accountant"`, `"Auditor"`, `"Viewer"`)*
- **Query Parameters**:
  - `startDate`: Filter income & expense transactions starting on date (`YYYY-MM-DD`)
  - `endDate`: Filter income & expense transactions up to date (`YYYY-MM-DD`)
  - `asOfDate`: Alternative end date parameter (`YYYY-MM-DD`)
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "startDate": "2026-07-01",
      "endDate": "2026-07-31",
      "asOfDate": null,
      "revenues": [
        {
          "id": "f5a7b02c-...",
          "code": "4010",
          "name": "Consulting Services Revenue",
          "type": "REVENUE",
          "amount": 3000.00
        }
      ],
      "totalRevenue": 3000.00,
      "expenses": [
        {
          "id": "g6b8c03d-...",
          "code": "5010",
          "name": "Software Licenses Expense",
          "type": "EXPENSE",
          "amount": 1200.00
        }
      ],
      "totalExpenses": 1200.00,
      "netProfit": 1800.00,
      "isProfit": true
    }
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: Invalid date format.
  - `401 Unauthorized`: Missing or invalid JWT token.
- **Verification Command**:
  ```bash
  curl -X GET "http://localhost:4000/api/v1/reports/profit-loss?startDate=2026-07-01&endDate=2026-07-31" -H "Authorization: Bearer <jwt_token>" -H "X-Tenant-ID: acme-acc"
  ```

#### Endpoint: `GET /api/v1/reports/balance-sheet`
- **Description**: Retrieves Balance Sheet report calculating total Assets, total Liabilities, direct Equity accounts, accumulated Retained Earnings (cumulative Net Profit/Loss), total Equity, and verifies the core accounting equation (`Assets == Liabilities + Equity`, `isBalanced === true`).
- **Headers Required**:
  ```http
  Authorization: Bearer <jwt_token>
  X-Tenant-ID: <tenant_id_or_slug>
  ```
  *(Supported Roles: `"Admin"`, `"Accountant"`, `"Auditor"`, `"Viewer"`)*
- **Query Parameters**:
  - `asOfDate`: Balance sheet date snapshot (`YYYY-MM-DD`)
  - `endDate`: Alternative snapshot date parameter (`YYYY-MM-DD`)
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "asOfDate": "2026-07-31",
      "assets": [
        {
          "id": "e4f8a01d-...",
          "code": "1010",
          "name": "Cash & Bank",
          "type": "ASSET",
          "balance": 7500.00
        }
      ],
      "totalAssets": 7500.00,
      "liabilities": [
        {
          "id": "h7c9d04e-...",
          "code": "2010",
          "name": "Accounts Payable",
          "type": "LIABILITY",
          "balance": 700.00
        }
      ],
      "totalLiabilities": 700.00,
      "equity": [
        {
          "id": "i8d0e05f-...",
          "code": "3010",
          "name": "Owner Capital",
          "type": "EQUITY",
          "balance": 5000.00
        }
      ],
      "totalEquityAccounts": 5000.00,
      "retainedEarnings": 1800.00,
      "totalEquity": 6800.00,
      "totalLiabilitiesAndEquity": 7500.00,
      "isBalanced": true
    }
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: Invalid date format.
  - `401 Unauthorized`: Missing or invalid JWT token.
- **Verification Command**:
  ```bash
  curl -X GET "http://localhost:4000/api/v1/reports/balance-sheet?asOfDate=2026-07-31" -H "Authorization: Bearer <jwt_token>" -H "X-Tenant-ID: acme-acc"
  ```

---

## 📋 Handoff Template (For Backend Team Reference)

When adding a completed endpoint, use the following template:

### Endpoint: `[HTTP_METHOD] /api/v1/resource`
- **Description**: Short summary of what this endpoint does.
- **Headers Required**:
  ```http
  Authorization: Bearer <jwt_token>
  X-Tenant-ID: <tenant_uuid_or_slug>
  Content-Type: application/json
  ```
- **Request Payload**:
  ```json
  {
    "example_field": "string"
  }
  ```
- **Success Response (200 OK / 201 Created)**:
  ```json
  {
    "success": true,
    "data": {}
  }
  ```
- **Verification Command**:
  ```bash
  curl -X POST http://localhost:4000/api/v1/resource -H "Content-Type: application/json" -d '{...}'
  ```
