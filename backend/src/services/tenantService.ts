import { PrismaClient } from '@prisma/client';
import * as tenantRepository from '../repository/tenantRepository';
import * as userRepository from '../repository/userRepository';
import { sanitizeSchemaName, dropTenantSchema } from '../database/tenantSchemaManager';
import { runMigrationsForSchema } from '../database/tenantMigrationRunner';
import { hashPassword } from '../utils/password';
import { generateJwtToken } from '../utils/jwt';

export interface OnboardTenantDTO {
  companyName?: string;
  name?: string;
  tenantName?: string;
  slug?: string;
  adminEmail?: string;
  email?: string;
  adminPassword?: string;
  password?: string;
  adminName?: string;
}

export interface OnboardTenantResult {
  tenant: {
    id: string;
    name: string;
    slug: string;
    schema: string;
    createdAt: Date;
  };
  admin: {
    id: string;
    email: string;
    name: string;
    role: string;
    tenantId: string | null;
    createdAt: Date;
  };
  token: string;
  migration: {
    appliedMigrations: string[];
  };
}

export class TenantOnboardingError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'TenantOnboardingError';
    this.statusCode = statusCode;
  }
}

/**
 * Normalizes input DTO and generates a clean URL-friendly slug.
 */
export function generateSlug(rawSlug?: string, companyName?: string): string {
  if (rawSlug && rawSlug.trim().length > 0) {
    return rawSlug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  if (companyName && companyName.trim().length > 0) {
    return companyName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  return '';
}

/**
 * Service function to execute tenant onboarding process:
 * 1. Validates request payload.
 * 2. Registers tenant record in public.tenants table.
 * 3. Dynamically provisions PostgreSQL tenant schema (tenant_<slug>).
 * 4. Runs initial core DDL migrations (001_initial_tenant_core_schema).
 * 5. Registers the tenant Admin user in public.users.
 * 6. Generates and returns Admin JWT token and tenant details.
 */
export async function onboardTenant(
  prisma: PrismaClient,
  dto: OnboardTenantDTO
): Promise<OnboardTenantResult> {
  // 1. Extract and validate fields
  const companyName = (dto.companyName || dto.tenantName || dto.name || '').trim();
  if (!companyName) {
    throw new TenantOnboardingError('Company name (companyName or name) is required', 400);
  }

  const slug = generateSlug(dto.slug, companyName);
  if (!slug) {
    throw new TenantOnboardingError('A valid tenant slug is required', 400);
  }

  const adminEmail = (dto.adminEmail || dto.email || '').trim().toLowerCase();
  if (!adminEmail) {
    throw new TenantOnboardingError('Admin email (adminEmail or email) is required', 400);
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(adminEmail)) {
    throw new TenantOnboardingError('Invalid email format for tenant Admin user', 400);
  }

  const adminPassword = (dto.adminPassword || dto.password || '').trim();
  if (!adminPassword || adminPassword.length < 6) {
    throw new TenantOnboardingError('Admin password must be at least 6 characters long', 400);
  }

  let adminName = (dto.adminName || '').trim();
  if (!adminName) {
    adminName = dto.name && dto.name !== companyName ? dto.name.trim() : `${companyName} Admin`;
  }

  const schemaName = sanitizeSchemaName(slug);

  // 2. Uniqueness checks
  const existingTenant = await tenantRepository.findTenantBySlug(prisma, slug);
  if (existingTenant) {
    throw new TenantOnboardingError(`Tenant with slug "${slug}" already exists`, 409);
  }

  const existingUser = await userRepository.findUserByEmail(prisma, adminEmail);
  if (existingUser) {
    throw new TenantOnboardingError(`User with email "${adminEmail}" already exists`, 409);
  }

  // 3. Register tenant in public.tenants
  let tenantRecord;
  try {
    tenantRecord = await tenantRepository.createTenant(prisma, {
      name: companyName,
      slug,
      schema: schemaName,
    });
  } catch (err: any) {
    if (err.message && err.message.includes('unique constraint')) {
      throw new TenantOnboardingError(`Tenant with slug "${slug}" or schema "${schemaName}" already exists`, 409);
    }
    throw err;
  }

  // 4. Provision dedicated PostgreSQL tenant schema & run core DDL migrations
  let migrationResult;
  try {
    migrationResult = await runMigrationsForSchema(prisma, schemaName, tenantRecord.id);
  } catch (error) {
    // Cleanup created tenant entry and schema on failure
    await tenantRepository.deleteTenantBySlug(prisma, slug);
    await dropTenantSchema(prisma, schemaName).catch(() => {});
    throw new TenantOnboardingError(`Failed to provision tenant schema: ${(error as Error).message}`, 500);
  }

  // 5. Register Tenant Admin user in public.users
  let adminUser;
  try {
    const hashedPassword = hashPassword(adminPassword);
    adminUser = await userRepository.createUser(prisma, {
      email: adminEmail,
      password: hashedPassword,
      name: adminName,
      role: 'Admin',
      tenantId: tenantRecord.id,
    });
  } catch (error) {
    // Cleanup tenant entry and schema on user creation failure
    await tenantRepository.deleteTenantBySlug(prisma, slug);
    await dropTenantSchema(prisma, schemaName).catch(() => {});
    throw new TenantOnboardingError(`Failed to create tenant Admin user: ${(error as Error).message}`, 500);
  }

  // 6. Generate JWT authentication token for Admin user
  const token = generateJwtToken({
    id: adminUser.id,
    email: adminUser.email,
    role: adminUser.role,
    tenantId: tenantRecord.id,
    name: adminUser.name,
  });

  return {
    tenant: {
      id: tenantRecord.id,
      name: tenantRecord.name,
      slug: tenantRecord.slug,
      schema: tenantRecord.schema,
      createdAt: tenantRecord.createdAt,
    },
    admin: {
      id: adminUser.id,
      email: adminUser.email,
      name: adminUser.name,
      role: adminUser.role,
      tenantId: adminUser.tenantId || null,
      createdAt: adminUser.createdAt,
    },
    token,
    migration: {
      appliedMigrations: migrationResult.appliedMigrations,
    },
  };
}
