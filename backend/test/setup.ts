import { execSync } from 'child_process';
import { join } from 'path';
import { INestApplication, ModuleMetadata } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { signAccessToken } from '../src/access/access-token';
import { PrismaService } from '../src/prisma/prisma.service';
import type { Role } from '../src/generated/prisma/enums';
import {
  AuditProbeController,
  ProbeItemsService,
} from './audit-probe.controller';
import { ProbeController } from './probe.controller';

let migrated = false;

export function migrateTestDb(): void {
  if (migrated) return;
  execSync('npx prisma migrate deploy', {
    cwd: join(__dirname, '..'),
    env: process.env,
    stdio: 'pipe',
  });
  migrated = true;
}

export async function createTestApp(
  extraImports: ModuleMetadata['imports'] = [],
): Promise<INestApplication> {
  migrateTestDb();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, ...(extraImports ?? [])],
    controllers: [ProbeController, AuditProbeController],
    providers: [ProbeItemsService],
  }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

/** Truncates every table in the public schema (except Prisma's migration table). */
export async function resetDb(): Promise<void> {
  const dbName = new URL(process.env.DATABASE_URL ?? '').pathname.slice(1);
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `resetDb refuses to run: database "${dbName}" does not end with _test`,
    );
  }
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

/** Signs a full-stage access token for an existing user (reads role and organisation from the DB). */
export async function tokenFor(
  userId: string,
  stage: 'full' | '2fa' | 'setup' = 'full',
): Promise<string> {
  const prisma = new PrismaService();
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return signAccessToken({
      sub: user.id,
      role: user.role,
      org: user.organizationId,
      stage,
    });
  } finally {
    await prisma.$disconnect();
  }
}

export async function createOrganization(name = 'Org Test') {
  const prisma = new PrismaService();
  try {
    return await prisma.organization.create({ data: { name } });
  } finally {
    await prisma.$disconnect();
  }
}

export async function createFarm(organizationId: string, name = 'Ferme Test') {
  const prisma = new PrismaService();
  try {
    return await prisma.farm.create({ data: { organizationId, name } });
  } finally {
    await prisma.$disconnect();
  }
}

let userSeq = 0;

/** Creates a user (placeholder password hash) assigned to the given farms. */
export async function createUser(opts: {
  organizationId: string;
  role: Role;
  farmIds?: string[];
  active?: boolean;
  name?: string;
  passwordHash?: string;
}) {
  const prisma = new PrismaService();
  try {
    userSeq += 1;
    return await prisma.user.create({
      data: {
        organizationId: opts.organizationId,
        role: opts.role,
        active: opts.active ?? true,
        name: opts.name ?? `User ${userSeq}`,
        email: `user${userSeq}-${Date.now()}@test.local`,
        passwordHash: opts.passwordHash ?? 'not-a-real-hash',
        farms: {
          create: (opts.farmIds ?? []).map((farmId) => ({ farmId })),
        },
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}
