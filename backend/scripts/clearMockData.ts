import { prisma } from '../src/config/db';

async function clearMockData() {
  console.log('🧹 Purging all mock data and schemas from PostgreSQL...');

  try {
    // 1. Find all tenant_* PostgreSQL schemas
    const schemas: { schema_name: string }[] = await prisma.$queryRawUnsafe(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'tenant_%';"
    );

    for (const s of schemas) {
      console.log(`🗑️ Dropping schema: ${s.schema_name}`);
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${s.schema_name}" CASCADE;`);
    }

    // 2. Truncate public tables
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE public.users, public.invitations, public.tenants CASCADE;'
    );

    console.log('✅ Database successfully cleared! Workspace is 100% clean for fresh registration.');
  } catch (error) {
    console.error('❌ Error purging database:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

clearMockData();
