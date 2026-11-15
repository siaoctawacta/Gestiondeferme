import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { Role } from '../src/generated/prisma/enums';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createFarm,
  createOrganization,
  createUser,
  resetDb,
  tokenFor,
} from './setup';

const DAY_MS = 86_400_000;
export const daysAgo = (n: number) =>
  new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10);

export interface Id {
  id: string;
}
export interface Msg {
  message: string | string[];
}
export type Headers = Record<string, string>;

/**
 * One organisation with one farm, a poultry, a pig and a mixed building, and
 * helpers to act as a role and to create the records the rules are tested on.
 */
export class World {
  orgId = '';
  farmId = '';
  siteId = '';
  poultryBld = '';
  pigBld = '';
  otherBld = '';

  constructor(
    readonly app: INestApplication,
    readonly prisma: PrismaService,
  ) {}

  http() {
    return request(this.app.getHttpServer() as App);
  }

  /** Empties the database and rebuilds the organisation, farm and buildings. */
  async reset(): Promise<void> {
    await resetDb();
    this.orgId = (await createOrganization()).id;
    this.farmId = (await createFarm(this.orgId, 'Ferme A')).id;
    this.siteId = (
      await this.prisma.site.create({
        data: { farmId: this.farmId, name: 'Site A' },
      })
    ).id;
    const building = (name: string, type: 'AVICOLE' | 'PORCIN' | 'AUTRE') =>
      this.prisma.building
        .create({
          data: {
            farmId: this.farmId,
            siteId: this.siteId,
            name,
            type,
            capacity: 100_000,
          },
        })
        .then((b) => b.id);
    this.poultryBld = await building('Poulailler', 'AVICOLE');
    this.pigBld = await building('Porcherie', 'PORCIN');
    this.otherBld = await building('Magasin', 'AUTRE');
  }

  async actor(role: Role): Promise<Headers> {
    const user = await createUser({
      organizationId: this.orgId,
      role,
      farmIds: [this.farmId],
    });
    return {
      Authorization: `Bearer ${await tokenFor(user.id)}`,
      'X-Farm-Id': this.farmId,
    };
  }

  async post<T = Id>(
    headers: Headers,
    path: string,
    body: object = {},
    status = 201,
  ): Promise<T> {
    const res = await this.http()
      .post(`/api${path}`)
      .set(headers)
      .send(body)
      .expect(status);
    return res.body as T;
  }

  async lot(
    headers: Headers,
    over: Record<string, unknown> = {},
  ): Promise<Id & { code: string }> {
    return this.post(headers, '/batches', {
      species: 'AVICOLE',
      type: 'CHAIR',
      buildingId: this.poultryBld,
      entryDate: daysAgo(30),
      initialCount: 100,
      ...over,
    });
  }

  pigLot(headers: Headers, over: Record<string, unknown> = {}) {
    return this.lot(headers, {
      species: 'PORCIN',
      type: 'ENGRAISSEMENT',
      buildingId: this.pigBld,
      ...over,
    });
  }

  animal(headers: Headers, over: Record<string, unknown> = {}) {
    return this.post<Id & { tag: string }>(headers, '/animals', {
      category: 'TRUIE',
      buildingId: this.pigBld,
      ...over,
    });
  }
}
