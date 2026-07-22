# Service Level Agreement (SLA): Multi-Tenant Accounting Platform

## 1. Introduction
This Service Level Agreement (SLA) outlines the performance standards and support commitments for the Multi-Tenant Accounting Platform.

## 2. Service Availability (Uptime)
*   **Commitment:** We guarantee a minimum monthly uptime of **99.9%** for the Cloud-hosted (SaaS) version of the platform.
*   **Exclusions:** Uptime calculations exclude scheduled maintenance windows (announced 48 hours in advance) and issues caused by third-party infrastructure (e.g., global cloud provider outages).

## 3. Data Integrity and Backups
*   **Backups:** Automated full backups are performed every 24 hours, with incremental backups every 4 hours.
*   **Recovery Point Objective (RPO):** Maximum of 4 hours of data loss in the event of a catastrophic failure.
*   **Recovery Time Objective (RTO):** We aim to restore full service within 8 hours of a major disruption.

## 4. Support Response Times
We categorize support requests by severity:

| Severity | Description | Response Time | Resolution Goal |
| :--- | :--- | :--- | :--- |
| **Critical** | Platform down; all users affected. | < 1 Hour | 4 Hours |
| **High** | Core feature (e.g., Invoicing) broken; no workaround. | < 4 Hours | 12 Hours |
| **Medium** | Minor bug; workaround exists. | < 12 Hours | 3 Business Days |
| **Low** | General inquiry or feature request. | < 24 Hours | Next Release Cycle |

## 5. Security Standards
*   **Encryption:** All data is encrypted at rest (AES-256) and in transit (TLS 1.2+).
*   **Monitoring:** 24/7 security monitoring and intrusion detection are active.

## 6. Private/Headless Hosting Support
For businesses using the **Headless Server** on their own infrastructure:
*   **Software Guarantee:** We guarantee the software code is stable and bug-free as per our standard release.
*   **Infrastructure:** Uptime and performance are the responsibility of the Business's IT team.
*   **Support:** Our support is limited to the software engine and API functionality.
