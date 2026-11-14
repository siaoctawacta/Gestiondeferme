import type { ListQueryDto } from './list-query.dto';

export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export async function paginate<T>(
  q: ListQueryDto,
  find: (args: { skip: number; take: number }) => Promise<T[]>,
  count: () => Promise<number>,
): Promise<Page<T>> {
  const [items, total] = await Promise.all([
    find({ skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    count(),
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize };
}
