import type { ModuleKey } from '../../access/permissions';
import { overviewAccess } from './building-overview';

const reads =
  (...modules: ModuleKey[]) =>
  (m: ModuleKey) =>
    modules.includes(m);

describe('overviewAccess', () => {
  it('gives every part to a role that reads every module', () => {
    expect(
      overviewAccess(reads('lots', 'porcs', 'equipements', 'taches', 'sante')),
    ).toEqual({
      species: ['AVICOLE', 'PORCIN'],
      animals: true,
      equipment: true,
      tasks: true,
      health: true,
    });
  });

  it('leaves out each part whose module the role cannot read', () => {
    expect(overviewAccess(reads('lots', 'taches'))).toEqual({
      species: ['AVICOLE'],
      animals: false,
      equipment: false,
      tasks: true,
      health: false,
    });
    expect(overviewAccess(reads('porcs')).species).toEqual(['PORCIN']);
  });

  it('has no species, so no lots part, without lots nor porcs', () => {
    expect(overviewAccess(reads('stocks', 'equipements')).species).toEqual([]);
  });
});
