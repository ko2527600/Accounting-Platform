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
- **Tenant Context Requirement**: All multi-tenant endpoints require tenant identity in request headers.
- **Required Header**: `X-Tenant-ID` (or `X-Tenant-Slug` or `X-Tenant-Schema`).
- **Behavior**:
  - `tenantContextMiddleware` extracts header, resolves tenant schema (`tenant_<slug>`), and sets `AsyncLocalStorage` context.
  - Queries execute automatically within PostgreSQL schema search path (`SET search_path TO "tenant_<slug>", public`).
  - Returns `400 Bad Request` if mandatory tenant header is missing.

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
