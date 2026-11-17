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

  it('gives finance read to every role that reads the audit log (its snapshots carry salaries and costs)', () => {
    const readers = ALL_ROLES.filter((r) => can(r, 'audit', 'read'));
    expect(readers.length).toBeGreaterThan(0);
    for (const r of readers) expect(can(r, 'finance', 'read')).toBe(true);
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

  it('grants clients, ventes and finance as the sales workflow needs them', () => {
    const p = (r: Parameters<typeof permissionsFor>[0]) => permissionsFor(r);
    const W = ['read', 'create', 'update', 'delete'];
    expect(p('COMMERCIAL').clients).toEqual(W);
    expect(p('COMMERCIAL').ventes).toEqual(W);
    expect(p('COMMERCIAL').finance).toEqual([]);
    expect(p('COMPTABLE').clients).toEqual(['read']);
    expect(p('COMPTABLE').ventes).toEqual(['read', 'update', 'validate']);
    expect(p('COMPTABLE').finance).toEqual(W);
    expect(p('PROPRIETAIRE').clients).toEqual(['read']);
    expect(p('PROPRIETAIRE').ventes).toEqual(['read', 'validate']);
    expect(p('PROPRIETAIRE').finance).toEqual(['read']);
    for (const m of ['clients', 'ventes', 'finance'] as const) {
      expect(p('DIRECTEUR_FERME')[m]).toEqual(['read']);
      expect(p('AUDITEUR')[m]).toEqual(['read']);
      expect(p('SUPER_ADMIN')[m]).toEqual([...W, 'validate']);
      for (const r of [
        'RESP_AVICOLE',
        'RESP_PORCIN',
        'VETERINAIRE',
        'RESP_STOCK',
        'AGENT_ELEVAGE',
        'MAGASINIER',
      ] as const) {
        expect(p(r)[m]).toEqual([]);
      }
    }
    expect(can('COMMERCIAL', 'ventes', 'validate')).toBe(false);
    expect(can('COMPTABLE', 'ventes', 'create')).toBe(false);
    expect(can('COMPTABLE', 'finance', 'create')).toBe(true);
    expect(can('MAGASINIER', 'ventes', 'read')).toBe(false);
  });

  it('permissionsFor lists the allowed actions per module', () => {
    const p = permissionsFor('MAGASINIER');
    expect(p.stocks).toEqual(['read', 'create']);
    expect(p.finance).toEqual([]);
    expect(p.dashboard).toEqual(['read']);
  });

  it('grants personnel, taches and equipements as the slice-5 table says', () => {
    expect(can('RESP_AVICOLE', 'personnel', 'create')).toBe(true);
    expect(can('RESP_AVICOLE', 'personnel', 'update')).toBe(false);
    expect(can('RESP_PORCIN', 'personnel', 'create')).toBe(true);
    expect(can('AGENT_ELEVAGE', 'personnel', 'read')).toBe(false);
    expect(can('DIRECTEUR_FERME', 'personnel', 'update')).toBe(true);
    expect(can('COMPTABLE', 'personnel', 'read')).toBe(true);
    expect(can('COMPTABLE', 'personnel', 'create')).toBe(false);
    expect(can('PROPRIETAIRE', 'personnel', 'read')).toBe(true);
    expect(can('AUDITEUR', 'personnel', 'update')).toBe(false);
    expect(can('VETERINAIRE', 'taches', 'update')).toBe(true);
    expect(can('VETERINAIRE', 'taches', 'create')).toBe(false);
    expect(can('RESP_STOCK', 'taches', 'update')).toBe(true);
    expect(can('MAGASINIER', 'taches', 'update')).toBe(true);
    expect(can('COMPTABLE', 'taches', 'read')).toBe(false);
    expect(can('AGENT_ELEVAGE', 'equipements', 'create')).toBe(true);
    expect(can('AGENT_ELEVAGE', 'equipements', 'update')).toBe(false);
    expect(can('RESP_AVICOLE', 'equipements', 'create')).toBe(true);
    expect(can('RESP_PORCIN', 'equipements', 'update')).toBe(false);
    expect(can('MAGASINIER', 'equipements', 'read')).toBe(false);
  });
});
