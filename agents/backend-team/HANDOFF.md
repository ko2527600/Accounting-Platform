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
