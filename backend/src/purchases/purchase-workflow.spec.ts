import {
  can,
  isEditable,
  OWED_STATUSES,
  PURCHASE_ACTIONS,
  PURCHASE_STATUS_LIST,
  statusAfter,
  type PurchaseAction,
  type PurchaseStatusValue,
} from './purchase-workflow';

/** Every action and the statuses it may start from: the whole workflow. */
const MATRIX: Record<PurchaseAction, PurchaseStatusValue[]> = {
  edit: ['DEMANDE'],
  delete: ['DEMANDE'],
  validate: ['DEMANDE'],
  order: ['VALIDEE'],
  receive: ['COMMANDEE'],
  cancel: ['DEMANDE', 'VALIDEE', 'COMMANDEE'],
  pay: ['RECUE'],
  unpay: ['RECUE', 'PAYEE'],
};

describe('purchase workflow', () => {
  it('allows each action from exactly its statuses (action x status matrix)', () => {
    for (const action of PURCHASE_ACTIONS) {
      for (const status of PURCHASE_STATUS_LIST) {
        expect(`${action}@${status}:${can(status, action)}`).toBe(
          `${action}@${status}:${MATRIX[action].includes(status)}`,
        );
      }
    }
  });

  it('never receives a purchase that is already received, paid or cancelled', () => {
    for (const s of [
      'RECUE',
      'PAYEE',
      'ANNULEE',
      'DEMANDE',
      'VALIDEE',
    ] as const) {
      expect(can(s, 'receive')).toBe(false);
    }
    expect(can('COMMANDEE', 'receive')).toBe(true);
  });

  it('refuses everything from a cancelled purchase', () => {
    for (const action of PURCHASE_ACTIONS) {
      expect(can('ANNULEE', action)).toBe(false);
    }
  });

  it('says which status an action leads to', () => {
    expect(statusAfter('validate')).toBe('VALIDEE');
    expect(statusAfter('order')).toBe('COMMANDEE');
    expect(statusAfter('cancel')).toBe('ANNULEE');
    expect(statusAfter('receive', { settled: false })).toBe('RECUE');
    // nothing to pay: a received purchase worth 0 is settled at once
    expect(statusAfter('receive', { settled: true })).toBe('PAYEE');
    expect(statusAfter('pay', { settled: false })).toBe('RECUE');
    expect(statusAfter('pay', { settled: true })).toBe('PAYEE');
    expect(statusAfter('unpay')).toBe('RECUE');
    expect(statusAfter('edit')).toBeNull();
    expect(statusAfter('delete')).toBeNull();
  });

  it('lets only a request be edited, and owes money only once received', () => {
    expect(PURCHASE_STATUS_LIST.filter((s) => isEditable(s))).toEqual([
      'DEMANDE',
    ]);
    expect([...OWED_STATUSES]).toEqual(['RECUE', 'PAYEE']);
  });
});
