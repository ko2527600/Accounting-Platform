import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$executeRawUnsafe(`
    SELECT pg_terminate_backend(pg_stat_activity.pid)
    FROM pg_stat_activity
    WHERE pid <> pg_backend_pid()
      AND state = 'idle in transaction';
  `);
  console.log("Terminated idle connections:", result);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
