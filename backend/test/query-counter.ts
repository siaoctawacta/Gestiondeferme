import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';

const DELEGATE_METHODS = [
  'findMany',
  'findFirst',
  'findUnique',
  'groupBy',
  'count',
  'aggregate',
];

/**
 * The number of Prisma reads (model queries and raw queries) the app's own
 * client runs while `run` executes: spies on every model delegate and on
 * `$queryRaw`. Writes are not counted (reads are what must not grow with the data).
 */
export async function countQueries(
  app: INestApplication,
  run: () => Promise<void>,
): Promise<number> {
  const client: Record<string, unknown> = app.get<PrismaService>(
    PrismaService,
  ) as never;
  const spies: jest.SpyInstance[] = [];
  for (const key of Object.keys(client)) {
    if (key.startsWith('$') || key.startsWith('_')) continue;
    const delegate = client[key];
    if (!delegate || typeof delegate !== 'object') continue;
    for (const method of DELEGATE_METHODS) {
      if (typeof (delegate as Record<string, unknown>)[method] === 'function') {
        spies.push(
          jest.spyOn(delegate as Record<string, () => unknown>, method),
        );
      }
    }
  }
  spies.push(jest.spyOn(client as Record<string, () => unknown>, '$queryRaw'));
  try {
    await run();
    return spies.reduce((n, s) => n + s.mock.calls.length, 0);
  } finally {
    spies.forEach((s) => s.mockRestore());
  }
}
