import { RotateCcw } from 'lucide-react';
import { toRowActions } from '../components/module/rowActions';
import type { ModuleConfig } from '../components/module/types';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { lazyRetry } from '../components/lazyRetry';
import { EQUIPMENT_ACTIONS } from './equipmentActions';
import {
  CONDITIONS, EquipmentForm, equipmentDeleteGate, equipmentTypeLabel, interventions, type EquipmentRow,
} from './equipementsShared';

const EquipmentDetail = lazyRetry(() => import('../pages/details/EquipmentDetail').then((m) => ({ default: m.EquipmentDetail })));

const location = (e: EquipmentRow) => e.location ?? '—';

/** The retired equipment (`GET /equipment?retired=true`): read-only, with `Remettre en service`. */
const reformes: ModuleConfig<EquipmentRow> = {
  slug: 'equipements',
  group: 'Opérations',
  title: 'Réformés',
  subtitle: 'Équipements réformés.',
  endpoint: '/equipment',
  scope: { retired: 'true' },
  columns: [
    { key: 'name', header: 'ÉQUIPEMENT' },
    { key: 'type', header: 'TYPE', render: (e) => equipmentTypeLabel(e.type) },
    { key: 'location', header: 'EMPLACEMENT', render: location },
    { key: 'retiredAt', header: 'RÉFORMÉ LE', render: (e) => (e.retiredAt ? formatDate(e.retiredAt) : '—') },
  ],
  fields: [],
  noCreate: true,
  canEdit: () => false,
  canDelete: () => false,
  actions: [{
    key: 'reinstate', label: 'Remettre en service', icon: RotateCcw, permission: 'update',
    run: async (e, { refresh }) => { await api.post(`/equipment/${e.id}/reinstate`); refresh(); },
  }],
};

/**
 * `Équipements` as `m_equipements.png`: the equipment in service with its location, next maintenance and condition, the
 * interventions and the retired equipment. Master data: `update` creates and edits, `delete` deletes; declaring a breakdown
 * is a daily entry (`create`).
 */
export const equipements: ModuleConfig<EquipmentRow> = {
  slug: 'equipements',
  group: 'Opérations',
  title: 'Équipements',
  tabLabel: 'Équipements',
  subtitle: 'Couveuses, balances, pompes, groupes et maintenance.',
  endpoint: '/equipment',
  columns: [
    { key: 'name', header: 'ÉQUIPEMENT', sortable: true },
    { key: 'type', header: 'TYPE', render: (e) => equipmentTypeLabel(e.type) },
    { key: 'location', header: 'EMPLACEMENT', render: location },
    { key: 'nextMaintenance', header: 'PROCHAINE MAINTENANCE', sortable: true, render: (e) => (e.nextMaintenance ? formatDate(e.nextMaintenance) : '—') },
    { key: 'condition', header: 'ÉTAT' },
  ],
  statuses: CONDITIONS,
  statusKey: 'condition',
  form: EquipmentForm,
  createPermission: 'update',
  rowLabel: (e) => e.name,
  canDelete: equipmentDeleteGate,
  qr: 'equipement',
  detail: EquipmentDetail,
  actions: toRowActions(EQUIPMENT_ACTIONS),
  tabs: [
    { key: 'interventions', label: 'Interventions', config: interventions },
    { key: 'reformes', label: 'Réformés', config: reformes },
  ],
};
