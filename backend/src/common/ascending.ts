/** The distinct ids in ascending order, without the empty ones: the order every row lock is taken in. */
export const ascending = (ids: (string | null | undefined)[]): string[] =>
  [...new Set(ids.filter((id): id is string => !!id))].sort();
