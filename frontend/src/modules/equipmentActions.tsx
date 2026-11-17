import { Archive, RotateCcw, TriangleAlert, Wrench } from 'lucide-react';
import { ActionDialog } from '../components/module/ActionDialog';
import { ConfirmDialog } from '../components/module/ConfirmDialog';
import type { SharedActionDef } from '../components/module/rowActions';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { todayIso } from '../lib/format';
import { interventionFields, interventionPayload, type EquipmentRow } from './equipementsShared';

type DialogProps = { row: EquipmentRow; onClose: () => void; onDone: () => void };

function BreakdownDialog({ row, onClose, onDone }: DialogProps) {
  return (
    <ActionDialog
      title={`Déclarer une panne — ${row.name}`}
      fields={[
        { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: todayIso, max: todayIso() },
        { name: 'description', label: 'Description', type: 'text', required: true },
      ]}
      onSubmit={(body) => api.post(`/equipment/${row.id}/breakdowns`, body)}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

/**
 * An intervention on the equipment. On a broken one, a corrective intervention offers to repair the open breakdown
 * (checked: the equipment is put back in service in the chosen state).
 */
function InterventionDialog({ row, onClose, onDone }: DialogProps) {
  const { can } = useAuth();
  return (
    <ActionDialog
      title={`Intervention — ${row.name}`}
      fields={interventionFields(can, { equipment: row })}
      toPayload={(v) => interventionPayload(v, row.id)}
      onSubmit={(body) => api.post('/maintenance', body)}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

function RetireDialog({ row, onClose, onDone }: DialogProps) {
  return (
    <ConfirmDialog
      title={`Réformer ${row.name}`}
      message={`Réformer ${row.name} ? Il n'apparaîtra plus dans la liste ni dans les alertes.`}
      confirmLabel="Réformer"
      onClose={onClose}
      onConfirm={async () => { await api.post(`/equipment/${row.id}/retire`, { date: todayIso() }); onDone(); }}
    />
  );
}

function ReinstateDialog({ row, onClose, onDone }: DialogProps) {
  return (
    <ConfirmDialog
      title={`Remettre ${row.name} en service`}
      message={`Remettre ${row.name} en service ? Il reviendra dans la liste des équipements.`}
      confirmLabel="Remettre en service"
      onClose={onClose}
      onConfirm={async () => { await api.post(`/equipment/${row.id}/reinstate`); onDone(); }}
    />
  );
}

/**
 * The equipment's own actions, shared by its list rows and its detail page. A retired equipment takes none but its reinstatement. Declaring a
 * breakdown is a daily entry (`create`); interventions and retirement are master data (`update`).
 */
export const EQUIPMENT_ACTIONS: SharedActionDef<EquipmentRow>[] = [
  { key: 'breakdown', label: 'Déclarer une panne', icon: TriangleAlert, permission: 'create', visible: (e) => !e.retiredAt && e.condition !== 'EN_PANNE', Dialog: BreakdownDialog },
  { key: 'intervention', label: 'Intervention', icon: Wrench, permission: 'update', visible: (e) => !e.retiredAt, Dialog: InterventionDialog },
  { key: 'retire', label: 'Réformer', icon: Archive, permission: 'update', visible: (e) => !e.retiredAt, Dialog: RetireDialog },
  { key: 'reinstate', label: 'Remettre en service', icon: RotateCcw, permission: 'update', visible: (e) => Boolean(e.retiredAt), Dialog: ReinstateDialog },
];
