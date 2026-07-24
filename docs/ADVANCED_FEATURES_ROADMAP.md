# Implementation Strategy: Advanced Features & Staff Onboarding

This document provides a technical roadmap for implementing the next phase of the Multi-Tenant Accounting Platform. It focuses on the "Edge" features and the staff onboarding workflow, ensuring consistency across the backend and frontend.

---

## 1. Staff Onboarding & Scoped Access

### Backend Implementation
- **Database Schema:** Added an `Invitations` table to the global schema to track pending invites.
- **API Endpoints:**
  - `POST /api/v1/tenants/invite`: Generates a secure, time-limited token and sends an invitation email.
  - `POST /api/v1/auth/accept-invitation`: Validates the token, allows the staff member to set their password, and creates a user record linked to the specific `tenantId`.
- **Security:** Ensure the `tenantContextMiddleware` correctly identifies and scopes staff members based on their assigned `tenantId` in the JWT.

### Frontend Implementation
- **Team Management UI:** A dedicated dashboard for Admins to invite new staff, view pending invitations, and manage existing staff roles (e.g., Accountant, Auditor, Viewer).
- **Auth Flow:** Update the `AuthContext` and `ProtectedRoute` components to handle invited staff, ensuring they are correctly redirected to their business-specific dashboard upon login.

---

## 2. The "Edge" Features (Advanced Functionality)

### Audit Trail (Log)
- **Backend:** Implement a global middleware or Prisma hook that intercepts all create, update, and delete operations. Record the action, the affected entity, the timestamp, and the `userId` in a tenant-specific logs table.
- **Frontend:** Create an "Audit Log" view for Admins to monitor all activity within their tenant environment.

### Bulk Data Import
- **Backend:** Develop a service using `exceljs` / CSV parser to parse uploaded Excel/CSV files. Implement validation logic to ensure imported data conforms to the platform's data models.
- **Frontend:** Create a user-friendly "Import Data" wizard that guides users through the process of mapping their old data (e.g., from Tally or Excel) to the platform's Chart of Accounts and Ledgers.

### AI Ledger Categorization
- **Backend:** Integrate a lightweight LLM / rule-based AI engine call that analyzes transaction descriptions and suggests the most appropriate Ledger category.
- **Frontend:** Provide real-time suggestions to users during manual transaction entry, allowing them to accept or override the AI's recommendation.

### Scheduled Reporting
- **Backend:** Utilize the background worker / task scheduler to schedule recurring reporting tasks. Develop a service that generates PDF versions of key financial reports (Balance Sheet, P&L) and sends them via email to designated recipients.
- **Frontend:** Allow Business Owners to configure their reporting schedule and recipient list through the "Settings" dashboard.

### Connected Banking
- **Backend:** Implement an integration service for third-party banking APIs (e.g. Plaid / Salt Edge mock). Develop logic to securely pull and categorize bank transactions.
- **Frontend:** Create a "Bank Connect" interface that allows users to link their bank accounts and review/reconcile imported transactions.

---

## 3. Implementation Guidelines
- **Tenant Isolation:** All new features must strictly adhere to the schema-based multi-tenancy to ensure data privacy and security.
- **Spec-Driven Development:** Refer to `architecture_blueprint.md` and `CLAUDE.md` for overall project standards and tech stack conventions.
- **Documentation:** Continue to log all architectural decisions and significant changes in `STATUS.md`.
- **Testing:** Thoroughly test all new features with realistic data to ensure they function correctly in a multi-tenant environment.
