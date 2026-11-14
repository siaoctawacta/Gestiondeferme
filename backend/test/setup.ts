import { execSync } from 'child_process';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

let migrated = false;

function migrateTestDb(): void {
  if (migrated) return;
  execSync('npx prisma migrate deploy', {
    cwd: join(__dirname, '..'),
    env: process.env,
    stdio: 'pipe',
  });
  migrated = true;
}

export async function createTestApp(): Promise<INestApplication> {
  migrateTestDb();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

/** Truncates every table in the public schema (except Prisma's migration table). */
export async function resetDb(): Promise<void> {
  const prisma = new PrismaService();
  try {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    if (tables.length === 0) return;
    const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
    );
  } finally {
    await prisma.$disconnect();
  }
}
