import { ConflictException } from '@nestjs/common';
import { Transform } from 'class-transformer';
import type { Response } from 'express';
import { ExportColumn, sendExport } from './export';
import type { ListQueryDto } from './list-query.dto';
import { paginate } from './paginate';

export const NAME_TAKEN = 'Ce nom existe déjà';
export const IN_USE = 'Cet élément est utilisé ailleurs';
export const MAX_EXPORT_ROWS = 10_000;

/** Trims string input before validation (other types pass through to be rejected). */
export const Trim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

/** Trims an optional text; a blank one is a cleared field (null). */
export const TrimOrNull = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || null : value,
  );

export const containsInsensitive = (search: string) => ({
  contains: search,
  mode: 'insensitive' as const,
});

/**
 * Runs a write, turning a unique-constraint violation (P2002) into a 409 with
 * `message` and a foreign-key violation (P2003) into a 409 "in use".
 */
export async function orConflict<T>(
  write: () => Promise<T>,
  message = NAME_TAKEN,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === 'P2002') throw new ConflictException(message);
    if (code === 'P2003') throw new ConflictException(IN_USE);
    throw error;
  }
}

/**
 * Answers a list request: the file export when `format` is set, else a page.
 * `extra` adds fields next to `items` on the JSON page only.
 */
export async function sendList<T>(
  res: Response,
  q: ListQueryDto,
  filename: string,
  columns: ExportColumn<T>[],
  find: (range: { skip?: number; take: number }) => Promise<T[]>,
  count: () => Promise<number>,
  extra?: () => Promise<Record<string, unknown>>,
): Promise<void> {
  if (q.format) {
    const rows = await find({ take: MAX_EXPORT_ROWS });
    await sendExport(res, q.format, filename, rows, columns);
    return;
  }
  const [page, more] = await Promise.all([
    paginate(q, find, count),
    extra ? extra() : {},
  ]);
  res.json({ ...page, ...more });
}
