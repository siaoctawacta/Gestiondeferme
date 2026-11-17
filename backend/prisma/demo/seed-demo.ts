// Demo seed « Ferme Kpalimé »: loads a farm with data in every module, through the real write paths.
//
//   cd backend && DEMO_PASSWORD='<10+ characters>' SEED_ADMIN_EMAIL=<admin> npm run seed:demo
//
// The app boots in this process, listens on 127.0.0.1 on a free port and the demo is replayed over HTTP with a token
// signed for the seed administrator (`SEED_ADMIN_EMAIL`, created by `npx prisma db seed`): every row passes the guards,
// the validation, the herd, stock and finance ledgers and the audit, so every figure is the one the screens compute.
// The only direct SQL writes are the numbering counters (no API sets one: the reference invoice numbers are reached by
// moving the `FA` counter, the purchase numbers by moving `DA` and `BC`) and the marker `Setting demoSeed`, written last.
//
// Guards (exit code 1 unless said):
//   - NODE_ENV=production without ALLOW_DEMO_SEED=1: refused.
//   - marker present: nothing to do (exit 0).
//   - the farm already holds data without the marker (a failed or foreign load): refused, never half-repeated.
//
// Dates: every date is relative to the day the demo is loaded (demo-dates.ts). The reference screens date from
// 2026-11-14; its dates are moved forward by the days elapsed since, so the alerts, the stock days and the receivables
// read as they did that day.
//
// Differences from the reference screens (the rules a user meets prevent an exact copy):
//   - `Vaccination à venir` replaces the reference's `Vaccination en retard` (a planned act in the past would read late,
//     the reference one is planned two days ahead); a real late vaccination and a late treatment are added.
//   - 17 extra egg days of LP-2026-03 before the reference ones (FA-0309 sells 12 000 eggs): the Ponte total differs.
//   - Agro Provende SA owes 0, not 850 000: a supplier balance counts received purchases only.
//   - « Rentabilité du mois » shows the current month, not October (the reference invoices are older).
//   - Collecte des œufs is completed on the day the demo is loaded; the Pompe forage is due the day after the capture.
//   - Rows are added beyond the reference so that every screen, alert and report has content: users of the twelve roles,
//     LC-2026-15 deaths of yesterday (daily mortality alert), a late planned vaccination and treatment, a treatment
//     with a withdrawal period, two stock lots with an expiry date, purchases in every state, quotes, a partial
//     payment with a credit note, a cancelled invoice, a retired equipment, interventions with costs, a week of
//     attendance and last month's payroll. The alerts are therefore more than the reference's 14, and the alert order
//     differs; the dashboard feed and water are those of the latest day.
import { config } from 'dotenv';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { signAccessToken } from '../../src/access/access-token';
import { MIN_PASSWORD_LENGTH } from '../../src/auth/password';
import { configureApp } from '../../src/configure-app';
import { PrismaService } from '../../src/prisma/prisma.service';
import { DemoClient, DemoError, type DemoContext } from './demo-client';
import { seedCommerce, seedCustomers, seedFinance } from './demo-commerce';
import { seedEquipment, seedPersonnel, seedTasks } from './demo-operations';
import { seedHealth, seedLogistics } from './demo-logistics';
import { seedPremises, seedProduction } from './demo-production';
import { seedLegalIdentity, seedUsers } from './demo-users';

config({ quiet: true });

const FARM_NAME = 'Ferme Kpalimé';
const MARKER_KEY = 'demoSeed';
const MARKER_VERSION = 1;

export const MESSAGES = {
  production:
    'La démo ne se charge pas en production (ALLOW_DEMO_SEED=1 pour forcer)',
  alreadyLoaded: 'Données de démonstration déjà chargées',
  notEmpty:
    'La ferme contient déjà des données : chargez la démo sur une base vierge (npm run demo:reset en développement)',
};

class Refused extends Error {}

/** What a loaded demo holds, per module (printed at the end of the run). */
async function counts(
  prisma: PrismaService,
  farmId: string,
): Promise<Record<string, number>> {
  const where = { farmId };
  const counters: [string, () => Promise<number>][] = [
    ['Bâtiments', () => prisma.building.count({ where })],
    ['Lots', () => prisma.animalBatch.count({ where })],
    ['Animaux', () => prisma.animal.count({ where })],
    ['Saisies d’œufs', () => prisma.eggProduction.count({ where })],
    ['Distributions d’aliment', () => prisma.feedDistribution.count({ where })],
    ['Mouvements de stock', () => prisma.stockMovement.count({ where })],
    ['Achats', () => prisma.purchase.count({ where })],
    ['Actes de santé', () => prisma.healthAct.count({ where })],
    ['Devis', () => prisma.quote.count({ where })],
    ['Factures', () => prisma.invoice.count({ where })],
    ['Avoirs', () => prisma.creditNote.count({ where })],
    ['Écritures manuelles', () => prisma.financeEntry.count({ where })],
    ['Employés', () => prisma.employee.count({ where })],
    ['Présences', () => prisma.attendance.count({ where })],
    ['Tâches', () => prisma.task.count({ where })],
    ['Équipements', () => prisma.equipment.count({ where })],
    ['Interventions', () => prisma.maintenance.count({ where })],
  ];
  const out: Record<string, number> = {};
  for (const [label, count] of counters) out[label] = await count();
  return out;
}

async function farmHoldsData(
  prisma: PrismaService,
  farmId: string,
): Promise<boolean> {
  const where = { farmId };
  const found = await Promise.all([
    prisma.building.count({ where }),
    prisma.animalBatch.count({ where }),
    prisma.stockMovement.count({ where }),
    prisma.purchase.count({ where }),
    prisma.quote.count({ where }),
    prisma.invoice.count({ where }),
    prisma.financeEntry.count({ where }),
    prisma.employee.count({ where }),
    prisma.task.count({ where }),
    prisma.equipment.count({ where }),
  ]);
  return found.some((n) => n > 0);
}

/** Loads the demo; returns the process exit code. */
export async function runDemoSeed(): Promise<number> {
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.ALLOW_DEMO_SEED !== '1'
  ) {
    console.error(MESSAGES.production);
    return 1;
  }
  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  if (!adminEmail) {
    console.error(
      "SEED_ADMIN_EMAIL doit être défini (l'administrateur créé par `npx prisma db seed`)",
    );
    return 1;
  }

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    const baseUrl = `http://127.0.0.1:${((app.getHttpServer() as Server).address() as AddressInfo).port}`;
    const prisma = app.get(PrismaService);

    const admin = await prisma.user.findUnique({
      where: { email: adminEmail },
    });
    if (!admin)
      throw new Refused(
        `L'administrateur ${adminEmail} n'existe pas : lancez d'abord \`npx prisma db seed\``,
      );
    const farm = await prisma.farm.findFirst({
      where: {
        organizationId: admin.organizationId,
        name: FARM_NAME,
        userFarms: { some: { userId: admin.id } },
      },
    });
    if (!farm)
      throw new Refused(
        `La ferme « ${FARM_NAME} » n'existe pas : lancez d'abord \`npx prisma db seed\``,
      );

    const marker = await prisma.setting.findUnique({
      where: {
        organizationId_key: {
          organizationId: admin.organizationId,
          key: MARKER_KEY,
        },
      },
    });
    if (marker) {
      console.log(MESSAGES.alreadyLoaded);
      return 0;
    }
    if (await farmHoldsData(prisma, farm.id))
      throw new Refused(MESSAGES.notEmpty);
    const password = process.env.DEMO_PASSWORD ?? '';
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Refused(
        `DEMO_PASSWORD doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères`,
      );
    }

    const started = Date.now();
    const token = signAccessToken({
      sub: admin.id,
      role: admin.role,
      org: admin.organizationId,
      stage: 'full',
    });
    const ctx: DemoContext = {
      api: new DemoClient(baseUrl, token, farm.id),
      buildings: new Map(),
      users: new Map(),
      async setCounter(kind, last, mode = 'exact') {
        const organizationId = admin.organizationId;
        if (mode === 'raise') {
          await prisma.$executeRaw`INSERT INTO "DocumentCounter" ("organizationId", "kind", "last") VALUES (${organizationId}, ${kind}, ${last}) ON CONFLICT ("organizationId", "kind") DO UPDATE SET "last" = GREATEST("DocumentCounter"."last", ${last})`;
        } else {
          await prisma.$executeRaw`INSERT INTO "DocumentCounter" ("organizationId", "kind", "last") VALUES (${organizationId}, ${kind}, ${last}) ON CONFLICT ("organizationId", "kind") DO UPDATE SET "last" = ${last}`;
        }
      },
    };

    const step = async <T>(
      label: string,
      run: () => Promise<T>,
    ): Promise<T> => {
      const at = Date.now();
      const result = await run();
      console.log(`  ${label} (${((Date.now() - at) / 1000).toFixed(1)} s)`);
      return result;
    };

    console.log(`Chargement de la démo « ${FARM_NAME} »`);
    await step('identité légale, utilisateurs', async () => {
      await seedLegalIdentity(ctx);
      await seedUsers(ctx, password);
    });
    await step('sites et bâtiments', () => seedPremises(ctx));
    const customers = await seedCustomers(ctx);
    const production = await step('lots, œufs, porcs, alimentation', () =>
      seedProduction(ctx, customers.palmier),
    );
    await step('stocks, fournisseurs, achats', () => seedLogistics(ctx));
    await step('santé et biosécurité', () => seedHealth(ctx, production));
    await step('ventes, devis, avoirs', () =>
      seedCommerce(ctx, production, customers),
    );
    await step('finance', () => seedFinance(ctx, production));
    const employees = await step('personnel et présences', () =>
      seedPersonnel(ctx),
    );
    await step('tâches', () => seedTasks(ctx, production, employees));
    await step('équipements et maintenance', () => seedEquipment(ctx));

    // Written last: a run that stopped on the way leaves no marker and is refused next time.
    const value = { version: MARKER_VERSION, at: new Date().toISOString() };
    await prisma.setting.create({
      data: { organizationId: admin.organizationId, key: MARKER_KEY, value },
    });
    console.log(
      `Démo chargée en ${((Date.now() - started) / 1000).toFixed(1)} s`,
    );
    console.log(JSON.stringify(await counts(prisma, farm.id), null, 2));
    console.log(
      `Comptes de démonstration : <rôle>@kpalime.demo (ex. agent.elevage@kpalime.demo), mot de passe DEMO_PASSWORD`,
    );
    return 0;
  } catch (error) {
    if (error instanceof Refused) {
      console.error(error.message);
    } else if (error instanceof DemoError) {
      console.error(`La démo s'est arrêtée : ${error.message}`);
    } else {
      console.error(
        error instanceof Error ? (error.stack ?? error.message) : error,
      );
    }
    return 1;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void runDemoSeed().then((code) => process.exit(code));
}
