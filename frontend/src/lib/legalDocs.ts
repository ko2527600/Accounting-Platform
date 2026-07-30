export interface LegalDocLink {
  policyName: string;
  label: string;
  teaser: string;
}

export const LEGAL_DOCS: LegalDocLink[] = [
  {
    policyName: "terms-and-conditions",
    label: "Terms & Conditions",
    teaser: "How your business's multi-tenant workspace, data isolation, and account responsibilities work.",
  },
  {
    policyName: "privacy-policy",
    label: "Privacy Policy",
    teaser: "What we collect, every named third-party subprocessor, and your Ghana Data Protection Act rights.",
  },
  {
    policyName: "sla",
    label: "Service Level Agreement (SLA 99.9%)",
    teaser: "Our 99.9% monthly uptime guarantee for ledgers, point-of-sale, and financial reporting.",
  },
  {
    policyName: "customization-policy",
    label: "Customization Tier Policy",
    teaser: "How custom fields and schema isolation options are managed by your subscription tier.",
  },
];
