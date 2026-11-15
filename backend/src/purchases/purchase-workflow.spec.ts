import {
  canTransition,
  isEditable,
  nextStatuses,
  PURCHASE_STATUS_LIST,
  type PurchaseStatusValue,
} from './purchase-workflow';

const ALLOWED: [PurchaseStatusValue, PurchaseStatusValue][] = [
  ['DEMANDE', 'VALIDEE'],
  ['VALIDEE', 'COMMANDEE'],
  ['COMMANDEE', 'RECUE'],
  ['RECUE', 'PAYEE'],
  // Deleting a payment reopens the balance.
  ['PAYEE', 'RECUE'],
  ['DEMANDE', 'ANNULEE'],
  ['VALIDEE', 'ANNULEE'],
  ['COMMANDEE', 'ANNULEE'],
];

describe('purchase workflow', () => {
  it('allows exactly the listed transitions and no other', () => {
    for (const from of PURCHASE_STATUS_LIST) {
      for (const to of PURCHASE_STATUS_LIST) {
        const expected = ALLOWED.some(([f, t]) => f === from && t === to);
        expect(`${from}->${to}:${canTransition(from, to)}`).toBe(
          `${from}->${to}:${expected}`,
        );
      }
    }
  });

  it('refuses to receive from a request or an order not yet placed', () => {
    expect(canTransition('DEMANDE', 'RECUE')).toBe(false);
    expect(canTransition('VALIDEE', 'RECUE')).toBe(false);
    expect(canTransition('DEMANDE', 'COMMANDEE')).toBe(false);
  });

  it('refuses to cancel once received or paid, and to leave a cancellation', () => {
    expect(canTransition('RECUE', 'ANNULEE')).toBe(false);
    expect(canTransition('PAYEE', 'ANNULEE')).toBe(false);
    for (const to of PURCHASE_STATUS_LIST) {
      expect(canTransition('ANNULEE', to)).toBe(false);
    }
  });

  it('lists the next statuses of each status', () => {
    expect(nextStatuses('DEMANDE')).toEqual(['VALIDEE', 'ANNULEE']);
    expect(nextStatuses('COMMANDEE')).toEqual(['RECUE', 'ANNULEE']);
    expect(nextStatuses('RECUE')).toEqual(['PAYEE']);
    expect(nextStatuses('PAYEE')).toEqual(['RECUE']);
    expect(nextStatuses('ANNULEE')).toEqual([]);
  });

  it('lets only a request be edited', () => {
    expect(PURCHASE_STATUS_LIST.filter((s) => isEditable(s))).toEqual([
      'DEMANDE',
    ]);
  });
});
