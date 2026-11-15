import type { StatusDef } from '../components/module/types';

/* ---------------------------------------------------------------------------------------------
 * API shapes (backend contract of `/purchases`, Task 4). Reconcile with the backend here only.
 * ------------------------------------------------------------------------------------------- */

export type PurchaseStatus = 'DEMANDE' | 'VALIDEE' | 'COMMANDEE' | 'RECUE' | 'PAYEE' | 'ANNULEE';
export type PaymentMethod = 'ESPECES' | 'VIREMENT' | 'MOBILE_MONEY' | 'CHEQUE';

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
  status: PurchaseStatus;
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
export const methodLabel = (m: string) => PAYMENT_METHODS.find((x) => x.value === m)?.label ?? m;

/** Statuses from which a `Bon de commande` exists. */
export const ORDERED: PurchaseStatus[] = ['COMMANDEE', 'RECUE', 'PAYEE'];

/** Why a purchase can no longer be edited or deleted (only a `Demande` can). */
export const LOCKED = 'Enregistrement verrouillé';
export const editableGate = (p: Pick<PurchaseRow, 'status'>): true | string => (p.status === 'DEMANDE' ? true : LOCKED);

/** Σ quantity × unit price of rows as edited (empty cells count as 0), rounded to 2 decimals. */
export const linesTotal = (rows: { quantity?: string; unitPrice?: string }[]): number =>
  Math.round(rows.reduce((sum, r) => sum + Number(r.quantity || 0) * Number(r.unitPrice || 0), 0) * 100) / 100;
