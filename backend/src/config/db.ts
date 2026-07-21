import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export const connectDatabase = async (): Promise<void> => {
  try {
    await prisma.$connect();
    console.log('[Database] Connected successfully to PostgreSQL');
  } catch (error) {
    console.error('[Database] Connection failed:', error);
  }
};

export const disconnectDatabase = async (): Promise<void> => {
  await prisma.$disconnect();
};
