# Privacy Policy: Multi-Tenant Accounting Platform

> **Placeholder notice:** This document uses a placeholder legal entity name ("AccountGo") and placeholder contact email (`privacy@accountgo.com`). Before this policy is published in production, replace both with the real registered business name, registered address, and a real monitored contact email.

## 1. Who We Are

AccountGo ("we," "us," "our") operates a web-based, multi-tenant accounting and business management platform (the "Service") for businesses ("you," "the Business," "the Tenant"). This Privacy Policy explains what personal and business data we collect, how we use it, and the rights you have over it. It should be read alongside our [Terms and Conditions](./TERMS_AND_CONDITIONS.md).

## 2. Data We Collect

When you onboard a business workspace, we collect:

*   **Administrator account details:** full name, email address, mobile phone number, and a hashed password.
*   **Business details:** company/business name, workspace URL slug, and your chosen base operating currency.
*   **Financial and operational data you enter into the Service:** chart of accounts, journal entries, invoices, bills, inventory records, bank reconciliation data, and any other business records you create while using the platform.
*   **Technical data:** IP address, browser/device information, and access logs, collected automatically for security and audit purposes.

We do not require business registration numbers, tax identification numbers, or beneficial-ownership/KYC documentation to create a workspace. If a future feature requires this (for example, a payment processor integration), we will update this policy before collecting it.

## 3. Why We Use Your Mobile Phone Number

Your administrator mobile number is used specifically for:
*   Delivering the 4-digit SMS verification code during account setup.
*   Delivering instant SMS alerts when a cash till closes short.

## 4. Third Parties We Share Data With (Subprocessors)

We use the following third-party services to operate the platform. Each is used **only when your tenant has that integration configured and enabled** — none of these are contacted for a tenant that hasn't turned the feature on:

| Subprocessor | Purpose | Data Shared | Active When |
| :--- | :--- | :--- | :--- |
| **Google (Gmail SMTP)** | Delivering transactional email (verification, weekly executive reports, Quick Start Guide) | Recipient email address, email content | Always, for account verification and reporting emails |
| **Arkesel / mNotify** | Delivering SMS alerts and verification codes (Ghanaian SMS gateways) | Recipient phone number, message content | Only if your environment has an SMS gateway API key configured |
| **Mono** | Bank feed connection and transaction sync | Bank account identifiers and transaction data you authorize Mono to share | Only if your tenant connects a bank account via Mono Connect |
| **exchangerate-api.com** | Live foreign-exchange rates for multi-currency conversion | No personal or business data is sent — only currency codes are requested | Only if your tenant creates transactions in a currency other than your base currency |

We do not currently name a specific cloud hosting provider in this policy, because a production hosting provider has not yet been selected for this platform. This section will be updated with the hosting provider's name and location once one is chosen.

We do not sell your data to third parties.

## 5. Data Protection Compliance (Ghana)

We operate under the requirements of Ghana's **Data Protection Act, 2012 (Act 843)**. **Registration with Ghana's Data Protection Commission is currently in progress and has not yet been completed.** We will update this section with our registration number once registration is finalized. If you have questions about our compliance status in the meantime, contact us at the address in Section 9.

## 6. Data Retention

We retain your business's financial and transactional records for a **minimum of 7 years**, consistent with standard tax record-keeping expectations (e.g., Ghana Revenue Authority requirements). Account/administrator data (name, email, phone number) is retained for as long as your workspace remains active, plus the export/deletion window described in Section 7 after termination.

## 7. Data Export and Deletion on Termination

If you terminate your account or we terminate it for a documented reason:
*   You have **30 days** from the termination date to export your business's data in a standard format (e.g., CSV/PDF exports already available in the Service's reporting tools).
*   After that 30-day export window, we will permanently delete your tenant's data within a further **60 days** (90 days total from termination), except where we are legally required to retain financial records under Section 6's retention period.

These figures are the platform's stated defaults; if your service agreement specifies different terms, those terms control.

## 8. Your Rights

Subject to applicable law, you may request access to, correction of, or deletion of the personal data we hold about your administrator account by contacting us using the details in Section 9. We will respond within a reasonable time and consistent with our obligations under Section 6.

## 9. Contact Us

For any privacy-related questions or requests, contact: **privacy@accountgo.com** *(placeholder — replace with your real registered contact address before production launch)*.

## 10. Changes to This Policy

We may update this Privacy Policy from time to time. We will provide notice of significant changes through the Service or via email. Your continued use of the Service following such notice constitutes your acceptance of the revised policy.
