import { Decimal } from '@prisma/client/runtime/client';
import {
  canQuote,
  displayQuoteStatus,
  expiredQuoteWhere,
  quoteStatusWhere,
  INVOICE_ACTIONS,
  INVOICE_STATUS_LIST,
  invoiceStatusOf,
  QUOTE_ACTIONS,
  QUOTE_STATUS_LIST,
  quoteRefusal,
  quoteStatusAfter,
  refusal,
  REVENUE_STATUSES,
  type InvoiceAction,
  type InvoiceStatusValue,
  type QuoteAction,
  type QuoteStatusValue,
} from './sale-workflow';

const D = (v: number | string) => new Decimal(v);

describe('quote workflow', () => {
  const ALLOWED: Record<QuoteAction, QuoteStatusValue[]> = {
    edit: ['BROUILLON'],
    delete: ['BROUILLON'],
    send: ['BROUILLON'],
    accept: ['ENVOYE'],
    refuse: ['ENVOYE'],
    convert: ['ENVOYE', 'ACCEPTE'],
  };

  it('lists the actions and the stored statuses', () => {
    expect([...QUOTE_ACTIONS]).toEqual([
      'edit',
      'delete',
      'send',
      'accept',
      'refuse',
      'convert',
    ]);
    expect([...QUOTE_STATUS_LIST]).toEqual([
      'BROUILLON',
      'ENVOYE',
      'ACCEPTE',
      'REFUSE',
      'FACTURE',
    ]);
  });

  it('allows every listed (status, action) pair and refuses every other', () => {
    for (const status of QUOTE_STATUS_LIST) {
      for (const action of QUOTE_ACTIONS) {
        expect([status, action, canQuote(status, action)]).toEqual([
          status,
          action,
          ALLOWED[action].includes(status),
        ]);
      }
    }
  });

  it('says why a step is refused, and nothing when it is allowed', () => {
    expect(quoteRefusal('ENVOYE', 'edit')).toBe(
      'Seul un devis en brouillon peut être modifié',
    );
    expect(quoteRefusal('ACCEPTE', 'delete')).toBe(
      'Seul un devis en brouillon peut être supprimé',
    );
    expect(quoteRefusal('ENVOYE', 'send')).toBe('Ce devis a déjà été envoyé');
    expect(quoteRefusal('ACCEPTE', 'refuse')).toBe(
      'Seul un devis envoyé peut être accepté ou refusé',
    );
    expect(quoteRefusal('BROUILLON', 'accept')).toBe(
      'Seul un devis envoyé peut être accepté ou refusé',
    );
    expect(quoteRefusal('BROUILLON', 'convert')).toBe(
      'Seul un devis envoyé ou accepté peut être facturé',
    );
    expect(quoteRefusal('FACTURE', 'convert')).toBe(
      'Seul un devis envoyé ou accepté peut être facturé',
    );
    expect(quoteRefusal('BROUILLON', 'send')).toBeNull();
  });

  it('gives the status an action leads to', () => {
    expect(quoteStatusAfter('send')).toBe('ENVOYE');
    expect(quoteStatusAfter('accept')).toBe('ACCEPTE');
    expect(quoteStatusAfter('refuse')).toBe('REFUSE');
    expect(quoteStatusAfter('convert')).toBe('FACTURE');
    expect(quoteStatusAfter('edit')).toBeNull();
    expect(quoteStatusAfter('delete')).toBeNull();
  });

  it('derives Expiré from a sent quote past its validity, never from another status', () => {
    expect(displayQuoteStatus('ENVOYE', '2026-11-10', '2026-11-10')).toBe(
      'ENVOYE',
    );
    expect(displayQuoteStatus('ENVOYE', '2026-11-10', '2026-11-11')).toBe(
      'EXPIRE',
    );
    expect(displayQuoteStatus('ENVOYE', null, '2026-11-11')).toBe('ENVOYE');
    expect(displayQuoteStatus('ACCEPTE', '2026-11-01', '2026-11-11')).toBe(
      'ACCEPTE',
    );
    expect(displayQuoteStatus('BROUILLON', '2026-11-01', '2026-11-11')).toBe(
      'BROUILLON',
    );
  });

  it('writes the expiry rule once, as a database filter too', () => {
    const day = new Date('2026-11-11T00:00:00Z');
    expect(expiredQuoteWhere(day)).toEqual({
      status: 'ENVOYE',
      validUntil: { lt: day },
    });
    expect(quoteStatusWhere('EXPIRE', day)).toEqual(expiredQuoteWhere(day));
    expect(quoteStatusWhere('ENVOYE', day)).toEqual({
      status: 'ENVOYE',
      OR: [{ validUntil: null }, { validUntil: { gte: day } }],
    });
    expect(quoteStatusWhere('ACCEPTE', day)).toEqual({ status: 'ACCEPTE' });
  });

  it('lets an expired quote still be accepted, refused or converted, not sent', () => {
    // The stored status stays ENVOYE: the workflow reads that.
    expect(canQuote('ENVOYE', 'accept')).toBe(true);
    expect(canQuote('ENVOYE', 'refuse')).toBe(true);
    expect(canQuote('ENVOYE', 'convert')).toBe(true);
    expect(canQuote('ENVOYE', 'send')).toBe(false);
  });
});

describe('invoice workflow', () => {
  const snap = (
    status: InvoiceStatusValue,
    over: Partial<{ paid: number; credited: number; refundDue: number }> = {},
  ) => ({
    status,
    paid: D(over.paid ?? 0),
    credited: D(over.credited ?? 0),
    refundDue: D(over.refundDue ?? 0),
  });

  const ISSUED: InvoiceStatusValue[] = ['EMISE', 'PARTIELLE', 'SOLDEE'];
  const ALLOWED: Record<InvoiceAction, InvoiceStatusValue[]> = {
    edit: ['BROUILLON'],
    delete: ['BROUILLON'],
    issue: ['BROUILLON'],
    pay: ['EMISE', 'PARTIELLE'],
    unpay: ISSUED,
    credit: ISSUED,
    refund: ISSUED,
    cancel: ISSUED,
  };

  it('lists the actions, the statuses and the ones that count as revenue', () => {
    expect([...INVOICE_ACTIONS]).toEqual([
      'edit',
      'delete',
      'issue',
      'pay',
      'unpay',
      'credit',
      'refund',
      'cancel',
    ]);
    expect([...INVOICE_STATUS_LIST]).toEqual([
      'BROUILLON',
      'EMISE',
      'PARTIELLE',
      'SOLDEE',
      'ANNULEE',
    ]);
    expect([...REVENUE_STATUSES]).toEqual(['EMISE', 'PARTIELLE', 'SOLDEE']);
  });

  it('allows every listed (status, action) pair and refuses every other', () => {
    for (const status of INVOICE_STATUS_LIST) {
      for (const action of INVOICE_ACTIONS) {
        // `refund` also needs something to refund.
        const s = snap(status, { refundDue: 100 });
        expect([status, action, refusal(s, action) === null]).toEqual([
          status,
          action,
          ALLOWED[action].includes(status),
        ]);
      }
    }
  });

  it('has nothing to refund when nothing is due back', () => {
    expect(refusal(snap('SOLDEE'), 'refund')).toBe(
      'Rien à rembourser sur cette facture',
    );
    expect(refusal(snap('SOLDEE', { refundDue: 105000 }), 'refund')).toBeNull();
  });

  it('words each refusal', () => {
    expect(refusal(snap('EMISE'), 'edit')).toBe(
      'Une facture émise ne peut plus être modifiée : établissez un avoir',
    );
    expect(refusal(snap('SOLDEE'), 'edit')).toBe(
      'Une facture émise ne peut plus être modifiée : établissez un avoir',
    );
    expect(refusal(snap('ANNULEE'), 'edit')).toBe(
      'Seul un brouillon de facture peut être modifié',
    );
    expect(refusal(snap('EMISE'), 'delete')).toBe(
      'Seul un brouillon de facture peut être supprimé',
    );
    expect(refusal(snap('EMISE'), 'issue')).toBe(
      'Cette facture est déjà émise',
    );
    expect(refusal(snap('SOLDEE'), 'pay')).toBe(
      'Seule une facture émise et non soldée peut être payée',
    );
    expect(refusal(snap('BROUILLON'), 'pay')).toBe(
      'Seule une facture émise et non soldée peut être payée',
    );
    expect(refusal(snap('ANNULEE'), 'unpay')).toBe(
      'Ce paiement ne peut plus être supprimé',
    );
    expect(refusal(snap('BROUILLON'), 'credit')).toBe(
      'Seule une facture émise peut recevoir un avoir',
    );
    expect(refusal(snap('BROUILLON'), 'cancel')).toBe(
      'Seule une facture émise peut être annulée',
    );
  });

  it('refuses a cancellation by status, then payments, then credit notes', () => {
    expect(refusal(snap('ANNULEE', { paid: 5, credited: 5 }), 'cancel')).toBe(
      'Seule une facture émise peut être annulée',
    );
    expect(refusal(snap('PARTIELLE', { paid: 5, credited: 5 }), 'cancel')).toBe(
      "Supprimez d'abord les paiements de cette facture",
    );
    expect(refusal(snap('EMISE', { credited: 5 }), 'cancel')).toBe(
      'Cette facture a des avoirs : elle ne peut plus être annulée',
    );
    expect(refusal(snap('EMISE'), 'cancel')).toBeNull();
  });
});

describe('invoiceStatusOf', () => {
  const issued = { issued: true, cancelled: false };

  it('is Brouillon until issued and Annulée once cancelled', () => {
    expect(
      invoiceStatusOf({
        issued: false,
        cancelled: false,
        net: D(1000000),
        paid: D(0),
        refunded: D(0),
      }),
    ).toBe('BROUILLON');
    expect(
      invoiceStatusOf({
        issued: true,
        cancelled: true,
        net: D(1000000),
        paid: D(0),
        refunded: D(0),
      }),
    ).toBe('ANNULEE');
  });

  it('follows what is paid against the net', () => {
    const of = (net: number, paid: number, refunded = 0) =>
      invoiceStatusOf({
        ...issued,
        net: D(net),
        paid: D(paid),
        refunded: D(refunded),
      });
    expect(of(1000000, 0)).toBe('EMISE');
    expect(of(1000000, 600000)).toBe('PARTIELLE');
    expect(of(1000000, 1000000)).toBe('SOLDEE');
    // A credit note under what was paid: settled, with 105 000 to give back.
    expect(of(945000, 1050000)).toBe('SOLDEE');
    // The refund brings the invoice back to what is really settled.
    expect(of(945000, 1050000, 105000)).toBe('SOLDEE');
    // A total of 0 is settled at issue.
    expect(of(0, 0)).toBe('SOLDEE');
    // Refunds without a remaining payment: not partially paid.
    expect(of(1000000, 100000, 100000)).toBe('EMISE');
  });
});
