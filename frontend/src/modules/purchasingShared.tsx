import type { StatusDef } from '../components/module/types';

/* ---------------------------------------------------------------------------------------------
 * API shapes (backend contract of `/purchases`, Task 4). Reconcile with the backend here only.
 * ------------------------------------------------------------------------------------------- */

export type PurchaseStatus = 'DEMANDE' | 'VALIDEE' | 'COMMANDEE' | 'RECUE' | 'PAYEE' | 'ANNULEE';
export type PaymentMethod = 'ESPECES' | 'VIREMENT' | 'MOBILE_MONEY' | 'CHEQUE';
/** The branch of the farm a purchase belongs to; `GENERAL` (the default) is shared charges. */
export type Activity = 'AVICOLE' | 'PORCIN' | 'GENERAL';

/** `GET /purchases`. `reference` is the `BC-NNNN` once ordered, else the `DA-NNNN`; `article` is the first line's item (`+n` when more). */
export interface PurchaseRow {
  id: string;
  /** `YYYY-MM-DD` */
  date: string;
  reference: string;
  supplierName: string;
  article: string;
  /** Quantity of the first line. */
  quantity: number;
  /** Unit of the first line's article; absent when the API does not send it. */
  unit?: string;
  status: PurchaseStatus;
  activity: Activity;
  /** Σ received × price once received, else Σ ordered × price. */
  amount: number;
  paid: number;
  remaining: number;
}

/** A line of `GET /purchases/:id`; `itemId` is the stock item id, also the key of the lines sent to the API. */
export interface PurchaseLine {
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  /** The stored amount of the line (the API computes it): received quantity once received, else the ordered one. */
  amount: number;
  /** Ordered quantity × unit price, whatever was received: what the bon de commande states. */
  orderedAmount: number;
  /** Set by the reception. */
  receivedQuantity: number | null;
  lotNumber: string | null;
  /** `YYYY-MM-DD` */
  expiryDate: string | null;
}

export interface PurchasePayment {
  id: string;
  /** `YYYY-MM-DD` */
  date: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
}

/** One step already taken: `at` is the ISO timestamp, `by` the user's name; `note` carries a cancellation reason. */
export interface PurchaseStep {
  step: PurchaseStatus;
  at: string;
  by: string | null;
  note?: string | null;
}

/** `GET /purchases/:id`. */
export interface PurchaseData extends PurchaseRow {
  supplierId: string;
  /** The `DA-NNNN` request number, kept once the order has a `BC-NNNN` (`reference`). */
  requestNumber: string;
  orderNumber: string | null;
  /** `YYYY-MM-DD`: the day the goods were received; null before the reception. */
  receivedDate: string | null;
  /** Why the purchase was cancelled; null unless it was. */
  cancelReason: string | null;
  note: string | null;
  supplierPhone: string | null;
  supplierAddress: string | null;
  /** ISO timestamp of the order (`BC-NNNN` assigned); null before it. */
  orderedAt: string | null;
  lines: PurchaseLine[];
  payments: PurchasePayment[];
  history: PurchaseStep[];
}

/** What the workflow dialogs need of a purchase: a list row or the detail both fit. */
export type PurchaseRef = Pick<PurchaseRow, 'id' | 'reference' | 'status' | 'remaining'>;

/* --------------------------------------------------------------------------------------------- */

export const PURCHASE_STATUSES: StatusDef[] = [
  { value: 'DEMANDE', label: 'Demande', tone: 'neutral' },
  { value: 'VALIDEE', label: 'Validée', tone: 'warning' },
  { value: 'COMMANDEE', label: 'Commandée', tone: 'warning' },
  { value: 'RECUE', label: 'Reçue', tone: 'success' },
  { value: 'PAYEE', label: 'Payée', tone: 'success' },
  { value: 'ANNULEE', label: 'Annulée', tone: 'danger' },
];
export const statusDef = (s: string) => PURCHASE_STATUSES.find((x) => x.value === s);

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'ESPECES', label: 'Espèces' },
  { value: 'VIREMENT', label: 'Virement' },
  { value: 'MOBILE_MONEY', label: 'Mobile money' },
  { value: 'CHEQUE', label: 'Chèque' },
];
export const ACTIVITIES: { value: Activity; label: string }[] = [
  { value: 'AVICOLE', label: 'Avicole' },
  { value: 'PORCIN', label: 'Porcin' },
  { value: 'GENERAL', label: 'Général' },
];
export const activityLabel = (a: string) => ACTIVITIES.find((x) => x.value === a)?.label ?? a;

export const methodLabel = (m: string) => PAYMENT_METHODS.find((x) => x.value === m)?.label ?? m;

/** Statuses from which a `Bon de commande` exists. */
export const ORDERED: PurchaseStatus[] = ['COMMANDEE', 'RECUE', 'PAYEE'];

/** Why a purchase can no longer be edited or deleted (only a `Demande` can). */
export const LOCKED = 'Enregistrement verrouillé';
export const editableGate = (p: Pick<PurchaseRow, 'status'>): true | string => (p.status === 'DEMANDE' ? true : LOCKED);
