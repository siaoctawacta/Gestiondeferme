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

/** Statuses of a purchase whose goods are in: its amount is owed to the supplier (until paid). */
export const OWED_STATUSES: readonly PurchaseStatusValue[] = ['RECUE', 'PAYEE'];

/** What can be done to a purchase. `unpay` is the deletion of a payment. */
export const PURCHASE_ACTIONS = [
  'edit',
  'delete',
  'validate',
  'order',
  'receive',
  'cancel',
  'pay',
  'unpay',
] as const;

export type PurchaseAction = (typeof PURCHASE_ACTIONS)[number];

/**
 * The whole workflow: each action and the statuses it may start from. A
 * service asks `can(status, action)` under the purchase's row lock and nowhere
 * compares a status itself. Receiving only follows an order (never a paid or
 * received purchase: that would write its stock twice); a purchase is
 * cancelled only before it is received; lines change only in `DEMANDE`.
 */
const FROM: Record<PurchaseAction, PurchaseStatusValue[]> = {
  edit: ['DEMANDE'],
  delete: ['DEMANDE'],
  validate: ['DEMANDE'],
  order: ['VALIDEE'],
  receive: ['COMMANDEE'],
  cancel: ['DEMANDE', 'VALIDEE', 'COMMANDEE'],
  pay: ['RECUE'],
  unpay: ['RECUE', 'PAYEE'],
};

export const can = (
  status: PurchaseStatusValue,
  action: PurchaseAction,
): boolean => FROM[action].includes(status);

/** The actions that move the purchase to another status. */
type StatusChanging = Exclude<PurchaseAction, 'edit' | 'delete'>;

/**
 * The status an action leads to (null for `edit` and `delete`: the status does
 * not change). `settled`: nothing is left to pay once the action is done.
 */
export function statusAfter(
  action: StatusChanging,
  opts?: { settled?: boolean },
): PurchaseStatusValue;
export function statusAfter(
  action: PurchaseAction,
  opts?: { settled?: boolean },
): PurchaseStatusValue | null;
export function statusAfter(
  action: PurchaseAction,
  opts: { settled?: boolean } = {},
): PurchaseStatusValue | null {
  switch (action) {
    case 'validate':
      return 'VALIDEE';
    case 'order':
      return 'COMMANDEE';
    case 'cancel':
      return 'ANNULEE';
    case 'receive':
    case 'pay':
      return opts.settled ? 'PAYEE' : 'RECUE';
    case 'unpay':
      return 'RECUE';
    default:
      return null;
  }
}

/** Lines (and the request itself) can only be edited or deleted in `DEMANDE`. */
export const isEditable = (status: PurchaseStatusValue): boolean =>
  can(status, 'edit');

export const isPaid = (status: PurchaseStatusValue): boolean =>
  status === 'PAYEE';
export const isCancelled = (status: PurchaseStatusValue): boolean =>
  status === 'ANNULEE';
