import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

async function resolveMigrations() {
  console.log('📦 Resolving Prisma migrations baseline...');
  const migrationsDir = path.join(process.cwd(), 'prisma', 'migrations');
  const dirs = fs.readdirSync(migrationsDir).filter((f) =>
    fs.statSync(path.join(migrationsDir, f)).isDirectory()
  );

  for (const dir of dirs) {
    console.log(`➡️ Marking migration as applied: ${dir}`);
    try {
      execSync(`npx prisma migrate resolve --applied "${dir}"`, { stdio: 'inherit' });
    } catch (err: any) {
      console.warn(`⚠️ Warning resolving ${dir}:`, err.message);
    }
  }

  console.log('✅ All Prisma migrations have been baseline-resolved in _prisma_migrations table!');
}

resolveMigrations();
