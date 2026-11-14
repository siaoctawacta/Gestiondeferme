import { ConflictException } from '@nestjs/common';
import { IN_USE, NAME_TAKEN, orConflict } from './list-helpers';

const failing = (code: string) => () =>
  Promise.reject(Object.assign(new Error('db'), { code }));

describe('orConflict', () => {
  it('passes the result through', async () => {
    await expect(orConflict(() => Promise.resolve(7))).resolves.toBe(7);
  });

  it('maps a unique violation (P2002) to a 409 with the given message', async () => {
    const error = await orConflict(failing('P2002')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).message).toBe(NAME_TAKEN);
    await expect(orConflict(failing('P2002'), 'Déjà pris')).rejects.toThrow(
      'Déjà pris',
    );
  });

  it('maps a foreign-key violation (P2003) to a French 409', async () => {
    const error = await orConflict(failing('P2003')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).message).toBe(
      'Cet élément est utilisé ailleurs',
    );
    expect(IN_USE).toBe('Cet élément est utilisé ailleurs');
  });

  it('rethrows anything else untouched', async () => {
    await expect(orConflict(failing('P2025'))).rejects.toThrow('db');
  });
});
