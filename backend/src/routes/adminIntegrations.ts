import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { BroadcastService } from '../services/broadcastService';
import { isMonoConfigured } from '../services/monoService';
import { isHelpAssistantConfigured } from '../services/helpAssistantService';
import { isFxConfigured } from '../services/fxRateService';

const router = Router();

function verifyAdminPasscode(req: Request): boolean {
  const passcode = (req.query.passcode as string) || (req.headers['x-admin-passcode'] as string | undefined);
  return !!passcode && BroadcastService.verifyPasscode(passcode);
}

/**
 * GET /api/v1/admin/integrations
 * Platform-wide view of every third-party integration this codebase has -
 * for the Ledgio admin console, not a tenant-facing endpoint (a tenant only
 * ever sees their own status in Settings/Banking). Booleans only, same
 * "never expose the actual credential values" rule as /health's existing
 * email/sms block. Paystack/GRA E-VAT/Mono bank feeds are all per-tenant
 * integrations (each tenant enters their own merchant credentials, so their
 * customers' money settles to their own account instead of a shared Ledgio
 * one) - real adoption counts, not a single platform boolean.
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  if (!verifyAdminPasscode(req)) {
    res.status(401).json({ success: false, error: 'Unauthorized: valid master passcode required.' });
    return;
  }

  try {
    const platformWide = [
      {
        key: 'email',
        name: 'Email (SendGrid)',
        purpose: 'Invoice emails, dunning reminders, scheduled reports, verification/invite emails.',
        configured: Boolean(process.env.SENDGRID_API_KEY?.trim() && process.env.EMAIL_FROM?.trim()),
      },
      {
        key: 'sms',
        name: 'SMS Gateway',
        purpose: 'Till-close alerts to the boss phone number.',
        configured: Boolean(
          (process.env.SMS_GATEWAY_USER?.trim() && process.env.SMS_GATEWAY_PASS?.trim()) ||
            process.env.ARKESEL_API_KEY?.trim() ||
            process.env.MNOTIFY_API_KEY?.trim()
        ),
      },
      {
        key: 'mono',
        name: 'Mono (Open Banking)',
        purpose: 'Real bank-feed connection API partner key - individual bank accounts are still linked per-tenant below.',
        configured: isMonoConfigured(),
      },
      {
        key: 'fx',
        name: 'FX Rate Provider',
        purpose: 'Live exchange rates for multi-currency invoices/recurring invoices.',
        configured: isFxConfigured(),
      },
      {
        key: 'anthropic',
        name: 'AI Help Assistant (Anthropic)',
        purpose: 'In-app help chat available to every tenant.',
        configured: isHelpAssistantConfigured(),
      },
      {
        key: 'credentialEncryption',
        name: 'Credential Encryption',
        purpose: 'Prerequisite for any tenant to save GRA E-VAT credentials (AES-256-GCM at rest). Paystack uses Subaccounts instead, so it stores no secret here.',
        configured: Boolean(process.env.CREDENTIAL_ENCRYPTION_KEY?.trim()),
      },
    ];

    const [totalTenants, graConfiguredTenants, paystackConfiguredTenants, monoConnectedTenants] = await Promise.all([
      prisma.tenant.count(),
      prisma.tenant.count({
        where: { graTin: { not: null }, graDeviceNumber: { not: null }, graSecurityKeyEncrypted: { not: null } },
      }),
      prisma.tenant.count({ where: { paystackSubaccountCode: { not: null } } }),
      prisma.bankAccount.findMany({ where: { monoAccountId: { not: null } }, select: { tenantId: true }, distinct: ['tenantId'] }),
    ]);

    const perTenant = [
      {
        key: 'graEvat',
        name: 'GRA E-VAT / VSDC',
        purpose: 'Real-time certified invoice clearance - each tenant enters their own GRA-issued credentials.',
        tenantsConfigured: graConfiguredTenants,
        totalTenants,
      },
      {
        key: 'paystack',
        name: 'Paystack',
        purpose: 'Hosted pay-now checkout links on invoices, plus Mobile Money (MTN/AirtelTigo/Telecel Cash) - each tenant just enters their bank or MoMo details; Ledgio creates a Paystack Subaccount for them automatically.',
        tenantsConfigured: paystackConfiguredTenants,
        totalTenants,
      },
      {
        key: 'monoBankFeed',
        name: 'Bank Feed Connections (Mono)',
        purpose: 'Tenants with at least one bank account actually connected via Mono Connect.',
        tenantsConfigured: monoConnectedTenants.length,
        totalTenants,
      },
    ];

    res.status(200).json({ success: true, data: { platformWide, perTenant } });
  } catch (error: any) {
    console.error('[AdminIntegrations] Error:', error);
    res.status(500).json({ success: false, error: 'Failed to load integrations status.' });
  }
});

export default router;
