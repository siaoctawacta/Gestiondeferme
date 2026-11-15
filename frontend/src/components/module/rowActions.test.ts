import { describe, expect, it } from 'vitest';
import { canRunAction } from './rowActions';

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
