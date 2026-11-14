import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../src/auth/password';

config({ quiet: true });

const ORG_NAME = 'AgriPilot';
const FARM_NAME = 'Ferme Kpalimé';

async function main(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set to run the seed',
    );
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `SEED_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const organization =
      (await prisma.organization.findFirst({ where: { name: ORG_NAME } })) ??
      (await prisma.organization.create({ data: { name: ORG_NAME } }));
    const farm =
      (await prisma.farm.findFirst({
        where: { organizationId: organization.id, name: FARM_NAME },
      })) ??
      (await prisma.farm.create({
        data: { organizationId: organization.id, name: FARM_NAME },
      }));
    // update: {} keeps an existing admin (and its password) untouched on re-runs.
    const admin = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        organizationId: organization.id,
        email,
        name: 'Super administrateur',
        role: 'SUPER_ADMIN',
        passwordHash: await hashPassword(password),
      },
    });
    await prisma.userFarm.upsert({
      where: { userId_farmId: { userId: admin.id, farmId: farm.id } },
      update: {},
      create: { userId: admin.id, farmId: farm.id },
    });
    console.log(`Seed OK: ${ORG_NAME} / ${FARM_NAME} / ${email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
