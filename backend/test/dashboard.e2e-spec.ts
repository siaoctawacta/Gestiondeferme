import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import type { DashboardDto } from '../src/dashboard/dashboard.types';
import {
  createFarm,
  createOrganization,
  createTestApp,
  createUser,
  resetDb,
  tokenFor,
} from './setup';

describe('Dashboard (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let farmA: string;
  let farmB: string;
  let headersFor: (farm: string) => Record<string, string>;

  const http = () => request(app.getHttpServer() as App);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
  });

  beforeEach(async () => {
    await resetDb();
    const org = await createOrganization();
    farmA = (await createFarm(org.id, 'Ferme Kpalimé')).id;
    farmB = (await createFarm(org.id, 'Ferme Atakpamé')).id;
    const site = await prisma.site.create({
      data: { farmId: farmA, name: 'Site A' },
    });
    const building = (name: string, status: 'ACTIF' | 'MAINTENANCE') =>
      prisma.building.create({
        data: {
          farmId: farmA,
          siteId: site.id,
          name,
          type: 'AVICOLE',
          capacity: 100,
          status,
        },
      });
    await building('B1', 'ACTIF');
    await building('B2', 'ACTIF');
    await building('B3', 'MAINTENANCE');
    const user = await createUser({
      organizationId: org.id,
      role: 'PROPRIETAIRE',
      farmIds: [farmA, farmB],
    });
    const token = await tokenFor(user.id);
    headersFor = (farm) => ({
      Authorization: `Bearer ${token}`,
      'X-Farm-Id': farm,
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('returns the contract with real farmName and activeBuildings', async () => {
    const res = await http()
      .get('/api/dashboard')
      .set(headersFor(farmA))
      .expect(200);
    const body = res.body as DashboardDto;
    expect(body.farmName).toBe('Ferme Kpalimé');
    expect(body.activeBuildings).toBe(2);
    expect(body.kpis.mortalityRate).toBeNull();
    expect(body.kpis.layingRate).toBeNull();
    expect(body.profitability).toEqual({
      revenue: 0,
      expenses: 0,
      margin: 0,
      marginPct: null,
      receivables: 0,
    });
    expect(body.revenueVsExpenses).toEqual([
      { activity: 'Avicole', revenue: 0, expenses: 0 },
      { activity: 'Porcin', revenue: 0, expenses: 0 },
      { activity: 'Général', revenue: 0, expenses: 0 },
    ]);
    expect(body.eggSeries).toEqual([]);
    expect(body.upcomingTasks).toEqual([]);
    expect(body.alerts).toEqual({ total: 0, items: [] });
  });

  it('scopes activeBuildings to the selected farm', async () => {
    const res = await http()
      .get('/api/dashboard')
      .set(headersFor(farmB))
      .expect(200);
    const body = res.body as DashboardDto;
    expect(body.farmName).toBe('Ferme Atakpamé');
    expect(body.activeBuildings).toBe(0);
  });

  it('aggregates across farms under X-Farm-Id: all', async () => {
    const res = await http()
      .get('/api/dashboard')
      .set(headersFor('all'))
      .expect(200);
    const body = res.body as DashboardDto;
    expect(body.farmName).toBe('Toutes les fermes');
    expect(body.activeBuildings).toBe(2);
  });

  it('serves GET /api/alerts', async () => {
    const res = await http()
      .get('/api/alerts')
      .set(headersFor(farmA))
      .expect(200);
    expect(res.body).toEqual({ total: 0, items: [] });
  });

  it('requires authentication', async () => {
    await http().get('/api/dashboard').expect(401);
  });
});
