import type { Decimal } from '@prisma/client/runtime/client';
import type { Prisma } from '../generated/prisma/client';

/*
 * The whole workflow of the sales documents, and the ONLY place a sale status
 * is compared. A service asks `canQuote(status, action)` / `refusal(snapshot,
 * action)` under the document's row lock and nowhere compares a status itself.
 */

// ------------------------------------------------------------------ quotes

/** The stored statuses of a quote, in the order of its life (`EXPIRE` is derived, see `displayQuoteStatus`). */
export const QUOTE_STATUS_LIST = [
  'BROUILLON',
  'ENVOYE',
  'ACCEPTE',
  'REFUSE',
  'FACTURE',
] as const;

export type QuoteStatusValue = (typeof QUOTE_STATUS_LIST)[number];

/** What a quote shows: its stored status, or `EXPIRE` (sent and past its validity). */
export type DisplayQuoteStatus = QuoteStatusValue | 'EXPIRE';

export const QUOTE_ACTIONS = [
  'edit',
  'delete',
  'send',
  'accept',
  'refuse',
  'convert',
] as const;

export type QuoteAction = (typeof QUOTE_ACTIONS)[number];

/** Each action and the stored statuses it may start from. An expired quote is still `ENVOYE`: it can be accepted, refused or converted. */
const QUOTE_FROM: Record<QuoteAction, QuoteStatusValue[]> = {
  edit: ['BROUILLON'],
  delete: ['BROUILLON'],
  send: ['BROUILLON'],
  accept: ['ENVOYE'],
  refuse: ['ENVOYE'],
  convert: ['ENVOYE', 'ACCEPTE'],
};

/** Why a quote action is refused (409). */
const QUOTE_REFUSED: Record<QuoteAction, string> = {
  edit: 'Seul un devis en brouillon peut être modifié',
  delete: 'Seul un devis en brouillon peut être supprimé',
  send: 'Ce devis a déjà été envoyé',
  accept: 'Seul un devis envoyé peut être accepté ou refusé',
  refuse: 'Seul un devis envoyé peut être accepté ou refusé',
  convert: 'Seul un devis envoyé ou accepté peut être facturé',
};

export const canQuote = (
  status: QuoteStatusValue,
  action: QuoteAction,
): boolean => QUOTE_FROM[action].includes(status);

/** The 409 message of a refused quote action, null when it is allowed. */
export const quoteRefusal = (
  status: QuoteStatusValue,
  action: QuoteAction,
): string | null => (canQuote(status, action) ? null : QUOTE_REFUSED[action]);

/** The actions that move a quote to another status (the others, `edit` and `delete`, leave it where it is). */
export type QuoteStep = Exclude<QuoteAction, 'edit' | 'delete'>;

const QUOTE_AFTER: Record<QuoteStep, QuoteStatusValue> = {
  send: 'ENVOYE',
  accept: 'ACCEPTE',
  refuse: 'REFUSE',
  convert: 'FACTURE',
};

/** The status a step leads to. */
export const quoteStatusAfter = (action: QuoteStep): QuoteStatusValue =>
  QUOTE_AFTER[action];

/**
 * `EXPIRE` when a sent quote is past its validity (`validUntil < today`; the
 * day itself still counts), never stored. Days are `YYYY-MM-DD` strings.
 */
export function displayQuoteStatus(
  status: QuoteStatusValue,
  validUntil: string | null,
  today: string,
): DisplayQuoteStatus {
  return status === 'ENVOYE' && validUntil !== null && validUntil < today
    ? 'EXPIRE'
    : status;
}

/**
 * Where a quote goes back to when the invoice draft made from it is deleted:
 * `ACCEPTE` when it had been accepted, else `ENVOYE` (a quote is converted
 * from one of the two).
 */
export const quoteStatusBeforeConversion = (quote: {
  acceptedAt: Date | null;
}): QuoteStatusValue => (quote.acceptedAt ? 'ACCEPTE' : 'ENVOYE');

/** The database side of the expiry rule above: a sent quote whose `validUntil` is before `day`. */
export const expiredQuoteWhere = (day: Date): Prisma.QuoteWhereInput => ({
  status: 'ENVOYE',
  validUntil: { lt: day },
});

/** The filter of one displayed status (`EXPIRE` and `ENVOYE` split the sent quotes on their validity). */
export function quoteStatusWhere(
  status: DisplayQuoteStatus,
  day: Date,
): Prisma.QuoteWhereInput {
  if (status === 'EXPIRE') return expiredQuoteWhere(day);
  if (status === 'ENVOYE') {
    return {
      status: 'ENVOYE',
      OR: [{ validUntil: null }, { validUntil: { gte: day } }],
    };
  }
  return { status };
}

// ---------------------------------------------------------------- invoices

export const INVOICE_STATUS_LIST = [
  'BROUILLON',
  'EMISE',
  'PARTIELLE',
  'SOLDEE',
  'ANNULEE',
] as const;

export type InvoiceStatusValue = (typeof INVOICE_STATUS_LIST)[number];

/** `unpay` is the deletion of a payment; `credit` an avoir; `refund` the giving back of an overpayment. */
export const INVOICE_ACTIONS = [
  'edit',
  'delete',
  'issue',
  'pay',
  'unpay',
  'credit',
  'refund',
  'cancel',
] as const;

export type InvoiceAction = (typeof INVOICE_ACTIONS)[number];

/** Invoices that count as a recette and as a créance (finance, customer balances). */
export const REVENUE_STATUSES: readonly InvoiceStatusValue[] = [
  'EMISE',
  'PARTIELLE',
  'SOLDEE',
];

/** Invoices that can still be owed: issued or partly paid (a settled one owes nothing, though it may owe a refund). */
export const OPEN_STATUSES: readonly InvoiceStatusValue[] = [
  'EMISE',
  'PARTIELLE',
];

const isIssued = (status: InvoiceStatusValue): boolean =>
  REVENUE_STATUSES.includes(status);

/** What the workflow needs to know of an invoice to answer for an action. */
export interface InvoiceSnapshot {
  status: InvoiceStatusValue;
  /** Σ of the encashments. */
  paid: Decimal;
  /** Σ of the credit notes. */
  credited: Decimal;
  /** What is owed back to the customer (see `balanceOf`). */
  refundDue: Decimal;
}

/** The exact 409 message of a refused action, null when the action is allowed. */
export function refusal(
  invoice: InvoiceSnapshot,
  action: InvoiceAction,
): string | null {
  const { status } = invoice;
  switch (action) {
    case 'edit':
      if (status === 'BROUILLON') return null;
      return status === 'ANNULEE'
        ? 'Seul un brouillon de facture peut être modifié'
        : 'Une facture émise ne peut plus être modifiée : établissez un avoir';
    case 'delete':
      return status === 'BROUILLON'
        ? null
        : 'Seul un brouillon de facture peut être supprimé';
    case 'issue':
      if (status === 'BROUILLON') return null;
      return status === 'ANNULEE'
        ? 'Cette facture est annulée : elle ne peut plus être émise'
        : 'Cette facture est déjà émise';
    case 'pay':
      return OPEN_STATUSES.includes(status)
        ? null
        : 'Seule une facture émise et non soldée peut être payée';
    case 'unpay':
      return isIssued(status) ? null : 'Ce paiement ne peut plus être supprimé';
    case 'credit':
      return isIssued(status)
        ? null
        : 'Seule une facture émise peut recevoir un avoir';
    case 'refund':
      return isIssued(status) && invoice.refundDue.gt(0)
        ? null
        : 'Rien à rembourser sur cette facture';
    case 'cancel':
      if (!isIssued(status)) return 'Seule une facture émise peut être annulée';
      if (invoice.paid.gt(0)) {
        return "Supprimez d'abord les paiements de cette facture";
      }
      if (invoice.credited.gt(0)) {
        return 'Cette facture a des avoirs : elle ne peut plus être annulée';
      }
      return null;
  }
}

/**
 * The status of an invoice from what it is worth now: `net` (total − credit
 * notes), `paid` (encashments) and `refunded`. Stored by the service after
 * every action, under the lock.
 */
export function invoiceStatusOf(i: {
  issued: boolean;
  cancelled: boolean;
  net: Decimal;
  paid: Decimal;
  refunded: Decimal;
}): InvoiceStatusValue {
  if (i.cancelled) return 'ANNULEE';
  if (!i.issued) return 'BROUILLON';
  if (i.net.sub(i.paid).add(i.refunded).lte(0)) return 'SOLDEE';
  if (i.paid.sub(i.refunded).gt(0)) return 'PARTIELLE';
  return 'EMISE';
}

/**
 * An issued invoice that is still owed and whose due date is before `today`
 * (the day itself is not late). Days are `YYYY-MM-DD` strings.
 */
export function isOverdue(
  invoice: { status: InvoiceStatusValue; due: Decimal; dueDate: string | null },
  today: string,
): boolean {
  return (
    OPEN_STATUSES.includes(invoice.status) &&
    invoice.due.gt(0) &&
    invoice.dueDate !== null &&
    invoice.dueDate < today
  );
}
