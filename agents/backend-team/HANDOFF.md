# Backend Handoff Contract for Frontend Team

This document is updated by the **Backend Team** whenever a backend service/endpoint is implemented, tested, and ready for consumption by the **Frontend Team**.

---

## 🟢 Available Services & APIs

*(No endpoints verified yet. The Backend Team will publish contracts here as tasks in `agents/backend-team/TASKS.md` are completed.)*

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
