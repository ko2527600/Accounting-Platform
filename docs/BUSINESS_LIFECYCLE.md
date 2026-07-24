# Business Lifecycle: Onboarding and Usage Framework

## 1. The "Verified Business" Onboarding Flow

To ensure the platform remains secure and compliant, we implement a multi-stage onboarding process known as **KYB (Know Your Business)**.

### Step 1: Registration & Initial Setup
*   **Action:** Business owner signs up with a professional email and creates a "Tenant Account."
*   **Automation:** The system automatically provisions a private database schema and a unique subdomain (e.g., `businessname.platform.com`).

### Step 2: Verification (The "Trust" Layer)
To be a "Verified Business," the owner must provide:
*   **Business Registration Certificate:** Uploaded for AI-assisted OCR verification.
*   **Tax ID (GST/VAT/EIN):** Validated against government databases via API.
*   **Proof of Address:** Utility bill or bank statement.
*   **Outcome:** Once verified, the business receives a "Verified" badge, unlocking higher transaction limits and Tier 2 customization.

### Step 3: Migration & Initialization
*   **Data Import:** Use our "Tally-to-Web" tool to upload XML/Excel exports from their old software.
*   **Chart of Accounts:** The business selects an industry template (e.g., Retail, Service, Manufacturing) to auto-generate their ledgers.

---

## 2. Daily Usage Workflow (How Businesses Use It)

The platform is designed to be the "Operating System" for the business, used by three main roles:

### Role A: The Business Owner (The "Observer")
*   **Primary View:** The **Executive Dashboard**.
*   **Usage:** Checks real-time Cash Flow, Profit & Loss, and Pending Receivables. Uses the "Go To" bar to quickly see which customers owe money.
*   **Action:** Approves high-value purchase orders from their mobile device.

### Role B: The Accountant (The "Power User")
*   **Primary View:** **Journal Entries & Ledger Reports**.
*   **Usage:** Uses **Keyboard Shortcuts** to record 50+ transactions an hour. Performs "Bank Reconciliation" by syncing with the bank API.
*   **Action:** Generates GST/Tax returns and locks the accounting period at the end of the month.

### Role C: The Sales/Inventory Staff (The "Inputter")
*   **Primary View:** **Invoicing & Stock Management**.
*   **Usage:** Creates sales invoices for customers. The system automatically updates stock levels in the background.
*   **Action:** Scans barcodes to add items to a sale.

---

## 3. The "Headless" Usage Scenario

For advanced businesses who want to use our "Headless" engine with their own internal tools:
*   **Integration:** They generate an **API Key** from our dashboard.
*   **Usage:** Their internal CRM (like Salesforce) automatically pushes every sale into our "Headless" accounting engine via API.
*   **Benefit:** They get professional-grade accounting reports without ever leaving their own internal software.

---

## 4. Support & Maintenance Lifecycle
*   **Automated Updates:** Every Sunday at 2 AM, the system updates with the latest tax laws and features.
*   **Health Monitoring:** Our backend monitors their "Data Integrity" and alerts them if an entry doesn't balance.
