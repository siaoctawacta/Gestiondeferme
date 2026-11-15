/** Where a row of the finance ledger comes from. */
export const ORIGINS = ['MANUEL', 'ACHAT', 'LOT', 'FACTURE', 'AVOIR'] as const;
export type Origin = (typeof ORIGINS)[number];

/** The ids the view gives its derived rows start with this; a manual entry's id is a plain cuid. */
export const isDerivedId = (id: string): boolean =>
  /^(achat|lot|facture|avoir):/.test(id);

/** `%` and `_` typed by the user are text, not wildcards. */
export const likePattern = (search: string): string =>
  `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
