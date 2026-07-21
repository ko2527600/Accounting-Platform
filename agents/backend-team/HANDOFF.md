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
