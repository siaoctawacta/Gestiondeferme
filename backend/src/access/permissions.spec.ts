import { can, permissionsFor } from './permissions';
import { ALL_ROLES } from './roles';

describe('permissions', () => {
  it('matches the permission table', () => {
    expect(can('AUDITEUR', 'ventes', 'read')).toBe(true);
    expect(can('AUDITEUR', 'ventes', 'create')).toBe(false);
    expect(can('AGENT_ELEVAGE', 'lots', 'create')).toBe(true);
    expect(can('AGENT_ELEVAGE', 'lots', 'delete')).toBe(false);
    expect(can('AGENT_ELEVAGE', 'finance', 'read')).toBe(false);
    expect(can('PROPRIETAIRE', 'achats', 'validate')).toBe(true);
    expect(can('PROPRIETAIRE', 'lots', 'create')).toBe(false);
    expect(can('MAGASINIER', 'stocks', 'delete')).toBe(false);
    expect(can('SUPER_ADMIN', 'utilisateurs', 'delete')).toBe(true);
  });

  it('gives every role dashboard and alertes read', () => {
    for (const r of ALL_ROLES) {
      expect(can(r, 'dashboard', 'read')).toBe(true);
      expect(can(r, 'alertes', 'read')).toBe(true);
    }
  });

  it('restricts fermes, utilisateurs, parametres writes to SUPER_ADMIN', () => {
    for (const m of ['fermes', 'utilisateurs', 'parametres'] as const) {
      for (const r of ALL_ROLES) {
        const reads =
          r === 'SUPER_ADMIN' || r === 'PROPRIETAIRE' || r === 'AUDITEUR';
        expect(can(r, m, 'read')).toBe(reads);
        expect(can(r, m, 'create')).toBe(r === 'SUPER_ADMIN');
        expect(can(r, m, 'update')).toBe(r === 'SUPER_ADMIN');
        expect(can(r, m, 'delete')).toBe(r === 'SUPER_ADMIN');
      }
    }
  });

  it('limits audit to SUPER_ADMIN, PROPRIETAIRE, DIRECTEUR_FERME and AUDITEUR (read)', () => {
    for (const r of ALL_ROLES) {
      const reads = [
        'SUPER_ADMIN',
        'PROPRIETAIRE',
        'DIRECTEUR_FERME',
        'AUDITEUR',
      ].includes(r);
      expect(can(r, 'audit', 'read')).toBe(reads);
    }
    expect(can('DIRECTEUR_FERME', 'audit', 'create')).toBe(false);
    for (const a of ['create', 'update', 'delete', 'validate'] as const) {
      expect(can('SUPER_ADMIN', 'audit', a)).toBe(false);
    }
    expect(can('SUPER_ADMIN', 'audit', 'read')).toBe(true);
  });

  it('applies the per-role rows', () => {
    expect(can('DIRECTEUR_FERME', 'lots', 'validate')).toBe(true);
    expect(can('DIRECTEUR_FERME', 'ventes', 'create')).toBe(false);
    expect(can('RESP_AVICOLE', 'lots', 'delete')).toBe(true);
    expect(can('RESP_AVICOLE', 'lots', 'validate')).toBe(false);
    expect(can('RESP_AVICOLE', 'porcs', 'read')).toBe(false);
    expect(can('RESP_STOCK', 'achats', 'create')).toBe(true);
    expect(can('RESP_STOCK', 'achats', 'delete')).toBe(false);
    expect(can('COMPTABLE', 'finance', 'delete')).toBe(true);
    expect(can('COMMERCIAL', 'ventes', 'update')).toBe(true);
    expect(can('AGENT_ELEVAGE', 'taches', 'update')).toBe(true);
    expect(can('AGENT_ELEVAGE', 'taches', 'create')).toBe(false);
    expect(can('MAGASINIER', 'achats', 'update')).toBe(true);
    expect(can('MAGASINIER', 'achats', 'create')).toBe(false);
    expect(can('PROPRIETAIRE', 'rapports', 'validate')).toBe(true);
    expect(can('SUPER_ADMIN', 'lots', 'validate')).toBe(true);
  });

  it('permissionsFor lists the allowed actions per module', () => {
    const p = permissionsFor('MAGASINIER');
    expect(p.stocks).toEqual(['read', 'create']);
    expect(p.finance).toEqual([]);
    expect(p.dashboard).toEqual(['read']);
  });
});
