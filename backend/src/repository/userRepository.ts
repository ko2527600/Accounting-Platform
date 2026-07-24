import { PrismaClient } from '@prisma/client';

export interface UserRecord {
  id: string;
  email: string;
  password?: string;
  name: string;
  phone?: string | null;
  role: string;
  tenantId?: string | null;
  isActive: boolean;
  isEmailVerified?: boolean;
  isPhoneVerified?: boolean;
  emailVerificationToken?: string | null;
  smsVerificationCode?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserData {
  email: string;
  password: string;
  name: string;
  phone?: string | null;
  role?: string;
  tenantId?: string | null;
  isActive?: boolean;
  isEmailVerified?: boolean;
  isPhoneVerified?: boolean;
  emailVerificationToken?: string | null;
  smsVerificationCode?: string | null;
}

/**
 * Ensures the `users` table exists.
 * Placeholder for compatibility since database schema is managed via Prisma migrations / db push.
 */
export async function ensureUserTableExists(prisma: PrismaClient): Promise<void> {
  // Database schema is fully managed and synchronized via Prisma
}

/**
 * Creates a new user record in the database using Prisma Client.
 */
export async function createUser(prisma: PrismaClient, data: CreateUserData): Promise<UserRecord> {
  const role = data.role || 'Viewer';

  const dbUser = await prisma.user.create({
    data: {
      email: data.email.toLowerCase().trim(),
      password: data.password,
      name: data.name.trim(),
      phone: data.phone || null,
      role,
      tenantId: data.tenantId || null,
      isActive: data.isActive !== undefined ? data.isActive : true,
      isEmailVerified: data.isEmailVerified !== undefined ? data.isEmailVerified : false,
      isPhoneVerified: data.isPhoneVerified !== undefined ? data.isPhoneVerified : false,
      emailVerificationToken: data.emailVerificationToken || null,
      smsVerificationCode: data.smsVerificationCode || null,
    },
  });

  return dbUser;
}

/**
 * Finds a user by email address (includes hashed password for credential verification).
 */
export async function findUserByEmail(prisma: PrismaClient, email: string): Promise<UserRecord | null> {
  return prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  });
}

/**
 * Finds a user by UUID (excludes password).
 */
export async function findUserById(prisma: PrismaClient, id: string): Promise<UserRecord | null> {
  return prisma.user.findUnique({
    where: { id },
  });
}

/**
 * Deletes a user by email (primarily for test cleanup).
 */
export async function deleteUserByEmail(prisma: PrismaClient, email: string): Promise<boolean> {
  try {
    const result = await prisma.user.delete({
      where: { email: email.toLowerCase().trim() },
    });
    return !!result;
  } catch {
    return false;
  }
}
