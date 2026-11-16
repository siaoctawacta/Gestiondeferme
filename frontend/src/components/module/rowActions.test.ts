import { describe, expect, it } from 'vitest';
import { Check } from 'lucide-react';
import { canRunAction, toRowActions } from './rowActions';

const holds = (...granted: string[]) => (_module: string, action: string) => granted.includes(action);

describe('canRunAction', () => {
  it('needs the permission, `update` by default', () => {
    expect(canRunAction(undefined, 'achats', holds('update'), true)).toBe(true);
    expect(canRunAction(undefined, 'achats', holds('read'), true)).toBe(false);
    expect(canRunAction('validate', 'achats', holds('update'), true)).toBe(false);
    expect(canRunAction('validate', 'achats', holds('validate'), true)).toBe(true);
  });

  it('keeps only `read` actions when writes are not possible', () => {
    expect(canRunAction('update', 'achats', holds('update'), false)).toBe(false);
    expect(canRunAction('read', 'achats', holds('read'), false)).toBe(true);
  });
});

describe('toRowActions', () => {
  it('turns a shared action definition into a row action, `Dialog` becoming `dialog`', () => {
    const Dialog = () => null;
    const visible = (row: { id: string }) => row.id === 'a';
    const [action] = toRowActions<{ id: string }>([{ key: 'pay', label: 'Payer', icon: Check, permission: 'validate', visible, Dialog }]);
    expect(action).toEqual({ key: 'pay', label: 'Payer', icon: Check, permission: 'validate', visible, dialog: Dialog });
  });
});
