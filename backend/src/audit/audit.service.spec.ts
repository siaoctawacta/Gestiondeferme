import { Decimal } from '@prisma/client/runtime/client';
import type { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { AuditService, sanitize } from './audit.service';

// The real service pulls in the generated client, which the unit config cannot resolve.
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

describe('sanitize', () => {
  it('serialises values with toJSON (Decimal, Date) instead of walking their internals', () => {
    const out = sanitize({
      price: new Decimal('12.50'),
      at: new Date('2026-01-02T03:04:05.000Z'),
      nested: [{ qty: new Decimal('3') }],
    });
    expect(out).toEqual({
      price: '12.5',
      at: '2026-01-02T03:04:05.000Z',
      nested: [{ qty: '3' }],
    });
  });

  it('still strips sensitive keys at every depth', () => {
    expect(
      sanitize({ a: { passwordHash: 'x', ok: 1 }, list: [{ tokenHash: 'y' }] }),
    ).toEqual({ a: { ok: 1 }, list: [{}] });
  });

  it('turns bigint into a string and keeps primitives', () => {
    expect(sanitize({ n: 10n, s: 'a', b: true, z: null })).toEqual({
      n: '10',
      s: 'a',
      b: true,
      z: null,
    });
  });
});

describe('AuditService.log', () => {
  const entry = {
    userId: 'u1',
    userName: 'Awa',
    organizationId: 'o1',
    module: 'lots',
    action: 'CREATE' as const,
  };
  const fakeClient = () => ({ auditLog: { create: jest.fn() } });

  it('writes through the transaction client when one is given', async () => {
    const prisma = fakeClient();
    const tx = fakeClient();
    const service = new AuditService(prisma as unknown as PrismaService);
    await service.log(entry, tx as unknown as Prisma.TransactionClient);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('writes through the default client otherwise', async () => {
    const prisma = fakeClient();
    const service = new AuditService(prisma as unknown as PrismaService);
    await service.log(entry);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('never throws when the write fails', async () => {
    const prisma = fakeClient();
    prisma.auditLog.create.mockRejectedValue(new Error('down'));
    const service = new AuditService(prisma as unknown as PrismaService);
    const logger = jest
      .spyOn(
        (service as unknown as { logger: { error: () => void } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);
    await expect(service.log(entry)).resolves.toBeUndefined();
    expect(logger).toHaveBeenCalled();
  });
});
