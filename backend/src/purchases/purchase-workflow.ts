/** The statuses of a purchase, in the order of its life. */
export const PURCHASE_STATUS_LIST = [
  'DEMANDE',
  'VALIDEE',
  'COMMANDEE',
  'RECUE',
  'PAYEE',
  'ANNULEE',
] as const;

export type PurchaseStatusValue = (typeof PURCHASE_STATUS_LIST)[number];

/**
 * What a purchase may become. A purchase is cancelled only before it is
 * received; `PAYEE → RECUE` is the deletion of a payment (the balance reopens).
 */
const NEXT: Record<PurchaseStatusValue, PurchaseStatusValue[]> = {
  DEMANDE: ['VALIDEE', 'ANNULEE'],
  VALIDEE: ['COMMANDEE', 'ANNULEE'],
  COMMANDEE: ['RECUE', 'ANNULEE'],
  RECUE: ['PAYEE'],
  PAYEE: ['RECUE'],
  ANNULEE: [],
};

export const nextStatuses = (status: PurchaseStatusValue) => [...NEXT[status]];

export const canTransition = (
  from: PurchaseStatusValue,
  to: PurchaseStatusValue,
): boolean => NEXT[from].includes(to);

/** Lines (and the request itself) can only be edited or deleted in `DEMANDE`. */
export const isEditable = (status: PurchaseStatusValue): boolean =>
  status === 'DEMANDE';
