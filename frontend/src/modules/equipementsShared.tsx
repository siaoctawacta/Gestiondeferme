import { RecordForm } from '../components/module/RecordForm';
import { LoadedRecord } from '../components/module/LoadedRecord';
import type { Field, ModuleConfig, RowGate, StatusDef } from '../components/module/types';
import { useAuth } from '../lib/auth';
import { formatDate, formatMoney, todayIso } from '../lib/format';
import type { Action, ModuleKey } from '../lib/modules';

/* ---------------------------------------------------------------------------------------------
 * API shapes (backend contract of `/equipment`, `/maintenance`, Task 4). Reconcile with the backend here only.
 * ------------------------------------------------------------------------------------------- */

export type EquipmentCondition = 'BON' | 'A_SURVEILLER' | 'EN_PANNE';
export type EquipmentType =
  | 'COUVEUSE' | 'BALANCE' | 'POMPE' | 'GROUPE_ELECTROGENE' | 'VENTILATEUR' | 'CHAUFFAGE' | 'ABREUVOIR' | 'MANGEOIRE' | 'VEHICULE' | 'AUTRE';
export type MaintenanceKind = 'PREVENTIVE' | 'CORRECTIVE';

/**
 * `GET /equipment`: `location` is the building name, else the site name. `openBreakdown` is the breakdown not yet repaired;
 * `hasHistory` is true as soon as an intervention, a breakdown or a task exists (it locks the delete icon);
 * `maintenanceIntervalDays` (days between two maintenances) gives the default of an intervention's next date.
 */
export interface EquipmentRow {
  id: string;
  name: string;
  type: EquipmentType;
  location: string | null;
  siteId: string | null;
  buildingId: string | null;
  condition: EquipmentCondition;
  /** `YYYY-MM-DD` */
  nextMaintenance: string | null;
  maintenanceDue: boolean;
  /** `YYYY-MM-DD`; set for a retired equipment only. */
  retiredAt: string | null;
  openBreakdown: { id: string; date: string; description: string } | null;
  hasHistory: boolean;
  maintenanceIntervalDays: number | null;
}

export interface BreakdownRow {
  id: string;
  date: string;
  description: string;
  repairId: string | null;
  /** `YYYY-MM-DD`; null while the breakdown is open. */
  resolvedDate: string | null;
}

/** `GET /equipment/:id`: the row plus what the edit form and the detail page need. `maintenanceCost` is null without `finance:read`. */
export interface EquipmentDetailData extends EquipmentRow {
  brand: string | null;
  serialNumber: string | null;
  purchaseDate: string | null;
  firstMaintenanceDate: string | null;
  note: string | null;
  interventions: MaintenanceRow[];
  breakdowns: BreakdownRow[];
  openTasks: number;
  maintenanceCost: number | null;
}

/** What the equipment dialogs and actions need of a list row or of the detail record. */
export type EquipmentRef = Pick<EquipmentRow, 'id' | 'name' | 'condition' | 'retiredAt' | 'maintenanceIntervalDays' | 'openBreakdown'>;

/** `GET /maintenance`: `cost` is null without `finance:read`; `repairs` marks the intervention that repaired a breakdown. */
export interface MaintenanceRow {
  id: string;
  date: string;
  equipmentId: string;
  equipmentName: string;
  kind: MaintenanceKind;
  description: string;
  performedBy: string | null;
  supplierId: string | null;
  supplierName: string | null;
  cost: number | null;
  nextDate: string | null;
  repairs: boolean;
}

/* --------------------------------------------------------------------------------------------- */

export const CONDITIONS: StatusDef[] = [
  { value: 'BON', label: 'Bon', tone: 'success' },
  { value: 'A_SURVEILLER', label: 'À surveiller', tone: 'warning' },
  { value: 'EN_PANNE', label: 'En panne', tone: 'danger' },
];

export const EQUIPMENT_TYPES: { value: EquipmentType; label: string }[] = [
  { value: 'COUVEUSE', label: 'Couveuse' },
  { value: 'BALANCE', label: 'Balance' },
  { value: 'POMPE', label: 'Pompe' },
  { value: 'GROUPE_ELECTROGENE', label: 'Groupe électrogène' },
  { value: 'VENTILATEUR', label: 'Ventilateur' },
  { value: 'CHAUFFAGE', label: 'Chauffage' },
  { value: 'ABREUVOIR', label: 'Abreuvoir' },
  { value: 'MANGEOIRE', label: 'Mangeoire' },
  { value: 'VEHICULE', label: 'Véhicule' },
  { value: 'AUTRE', label: 'Autre' },
];
export const equipmentTypeLabel = (t: string) => EQUIPMENT_TYPES.find((x) => x.value === t)?.label ?? t;

export const MAINTENANCE_KINDS: { value: MaintenanceKind; label: string }[] = [
  { value: 'PREVENTIVE', label: 'Préventive' },
  { value: 'CORRECTIVE', label: 'Corrective' },
];
export const maintenanceKindLabel = (k: string) => MAINTENANCE_KINDS.find((x) => x.value === k)?.label ?? k;

export const HAS_HISTORY = 'Équipement avec historique — réformez-le';
export const EQUIPMENT_RETIRED = 'Équipement réformé';
export const equipmentDeleteGate = (e: EquipmentRow): RowGate => (e.hasHistory ? HAS_HISTORY : true);

/** The date `n` calendar days after `iso` (`YYYY-MM-DD`). */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const trimmed = (v: unknown) => String(v ?? '').trim();
const numberOrEmpty = (v: unknown) => (v === '' || v === undefined ? '' : Number(v));

/* ----------------------------------------- equipment form ----------------------------------------- */

const toForm = (d: EquipmentDetailData) => ({
  name: d.name,
  type: d.type,
  locationKind: d.buildingId ? 'BATIMENT' : 'SITE',
  siteId: d.siteId ?? '',
  buildingId: d.buildingId ?? '',
  brand: d.brand ?? '',
  serialNumber: d.serialNumber ?? '',
  purchaseDate: d.purchaseDate ?? '',
  maintenanceIntervalDays: d.maintenanceIntervalDays === null ? '' : String(d.maintenanceIntervalDays),
  condition: d.condition,
  note: d.note ?? '',
});

function EquipmentFormBody({ record, onSaved, onClose }: { record?: EquipmentDetailData; onSaved: () => void; onClose: () => void }) {
  const broken = record?.condition === 'EN_PANNE';
  // A location kind is chosen with its site or building; only an equipment stored with none may stay without.
  const located = !record || record.siteId !== null || record.buildingId !== null;
  const fields = (values: Record<string, unknown>): Field[] => [
    { name: 'name', label: 'Nom', type: 'text', required: true },
    { name: 'type', label: 'Type', type: 'select', required: true, options: EQUIPMENT_TYPES },
    {
      name: 'locationKind', label: 'Emplacement', type: 'segmented', defaultValue: 'SITE',
      options: [{ value: 'SITE', label: 'Site' }, { value: 'BATIMENT', label: 'Bâtiment' }],
    },
    values.locationKind === 'BATIMENT'
      ? { name: 'buildingId', label: 'Bâtiment', type: 'select', required: located, options: { endpoint: '/buildings' }, optionsPermission: { module: 'batiments', action: 'read' }, currentLabel: record?.location ?? undefined }
      : { name: 'siteId', label: 'Site', type: 'select', required: located, options: { endpoint: '/sites' }, optionsPermission: { module: 'batiments', action: 'read' }, currentLabel: record?.location ?? undefined },
    { name: 'brand', label: 'Marque', type: 'text' },
    { name: 'serialNumber', label: 'N° de série', type: 'text' },
    { name: 'purchaseDate', label: "Date d'achat", type: 'date' },
    { name: 'maintenanceIntervalDays', label: 'Intervalle de maintenance (jours)', type: 'number', min: 1, step: 1 },
    { name: 'firstMaintenanceDate', label: 'Prochaine maintenance', type: 'date', only: 'create' },
    {
      name: 'condition', label: 'État', type: 'select', only: 'update', disabled: broken,
      hint: broken ? 'Remis en service par une intervention corrective' : undefined,
      currentLabel: 'En panne',
      options: CONDITIONS.filter((c) => c.value !== 'EN_PANNE').map(({ value, label }) => ({ value, label })),
    },
    { name: 'note', label: 'Note', type: 'textarea' },
  ];
  return (
    <RecordForm
      label="Équipements"
      row={record}
      fields={fields}
      initial={record ? toForm(record) : undefined}
      toPayload={(v) => ({
        name: trimmed(v.name),
        type: v.type,
        // The kind not chosen is cleared (`null` on an edit), so moving from a site to a building replaces it.
        siteId: v.locationKind === 'SITE' ? v.siteId ?? record?.siteId ?? '' : '',
        buildingId: v.locationKind === 'BATIMENT' ? v.buildingId ?? record?.buildingId ?? '' : '',
        brand: trimmed(v.brand),
        serialNumber: trimmed(v.serialNumber),
        purchaseDate: v.purchaseDate,
        maintenanceIntervalDays: numberOrEmpty(v.maintenanceIntervalDays),
        firstMaintenanceDate: v.firstMaintenanceDate,
        condition: v.condition,
        note: trimmed(v.note),
      })}
      createPath="/equipment"
      patchPath={(r) => `/equipment/${r.id}`}
      onSaved={onSaved}
      onClose={onClose}
    />
  );
}

/**
 * The add / edit dialog of an equipment. A list row does not carry every stored field (brand, serial number, purchase
 * date, note), so an edit loads the record first (the detail page's own query).
 */
export function EquipmentForm({ row, onSaved, onClose }: { row?: EquipmentRow; onSaved: () => void; onClose: () => void }) {
  if (!row) return <EquipmentFormBody onSaved={onSaved} onClose={onClose} />;
  return (
    <LoadedRecord<EquipmentDetailData> title="Modifier — Équipements" queryKey={['/equipment', 'detail', row.id]} path={`/equipment/${row.id}`} onClose={onClose}>
      {(record) => <EquipmentFormBody record={record} onSaved={onSaved} onClose={onClose} />}
    </LoadedRecord>
  );
}

/* --------------------------------------- intervention fields --------------------------------------- */

/**
 * The inputs of an intervention, shared by the `Intervention` dialog of an equipment (`equipment` given: its interval gives the
 * default of the next date, and a broken one offers to repair its breakdown) and by the add / edit form of the
 * `Interventions` tab (`equipment` absent: the equipment is chosen, or fixed by the list's scope). The cost is a
 * finance figure: only with `finance:read`.
 */
export function interventionFields(
  can: (module: ModuleKey, action: Action) => boolean,
  opts: { equipment?: EquipmentRef; chooseEquipment?: boolean },
): (values: Record<string, unknown>) => Field[] {
  const { equipment } = opts;
  const breakdown = equipment?.openBreakdown ?? null;
  return (values) => {
    // The checkbox is only shown for a corrective intervention, so its default (checked) is not in `values` yet on the first pass.
    const repairing = breakdown !== null && values.kind === 'CORRECTIVE' && (values.repairsBreakdown ?? true) !== false;
    return [
      ...(opts.chooseEquipment
        ? [{ name: 'equipmentId', label: 'Équipement', type: 'select', required: true, only: 'create', options: { endpoint: '/equipment' } } satisfies Field]
        : []),
      {
        name: 'kind', label: 'Type', type: 'segmented', required: true,
        defaultValue: equipment?.condition === 'EN_PANNE' ? 'CORRECTIVE' : 'PREVENTIVE', options: MAINTENANCE_KINDS,
      },
      { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: todayIso },
      { name: 'description', label: 'Description', type: 'text', required: true },
      { name: 'performedBy', label: 'Intervenant', type: 'text' },
      { name: 'supplierId', label: 'Fournisseur', type: 'select', options: { endpoint: '/suppliers' }, optionsPermission: { module: 'fournisseurs', action: 'read' } },
      ...(can('finance', 'read') ? [{ name: 'cost', label: 'Coût (FCFA)', type: 'number', min: 0, step: 0.01 } satisfies Field] : []),
      {
        name: 'nextDate', label: 'Prochaine maintenance', type: 'date',
        hint: equipment?.maintenanceIntervalDays && values.date ? `Par défaut : ${addDays(String(values.date), equipment.maintenanceIntervalDays)}` : undefined,
      },
      ...(breakdown && values.kind === 'CORRECTIVE'
        ? [{ name: 'repairsBreakdown', label: `Répare la panne du ${breakdown.date}`, type: 'checkbox', defaultValue: true } satisfies Field]
        : []),
      ...(repairing
        ? [{
            name: 'conditionAfter', label: 'État après intervention', type: 'select', required: true, defaultValue: 'BON',
            options: CONDITIONS.filter((c) => c.value !== 'EN_PANNE').map(({ value, label }) => ({ value, label })),
          } satisfies Field]
        : []),
    ];
  };
}

/** Request body of an intervention from the form values (`repairsBreakdown` and `conditionAfter` only when the form offered them). */
export function interventionPayload(v: Record<string, unknown>, equipmentId?: string): Record<string, unknown> {
  return {
    equipmentId: equipmentId ?? v.equipmentId,
    kind: v.kind,
    date: v.date,
    description: trimmed(v.description),
    performedBy: trimmed(v.performedBy),
    supplierId: v.supplierId,
    cost: numberOrEmpty(v.cost),
    nextDate: v.nextDate,
    ...('repairsBreakdown' in v ? { repairsBreakdown: Boolean(v.repairsBreakdown) } : {}),
    ...(v.repairsBreakdown ? { conditionAfter: v.conditionAfter } : {}),
  };
}

const interventionToForm = (m: MaintenanceRow) => ({
  kind: m.kind,
  date: m.date,
  description: m.description,
  performedBy: m.performedBy ?? '',
  supplierId: m.supplierId ?? '',
  cost: m.cost === null ? '' : String(m.cost),
  nextDate: m.nextDate ?? '',
});

/** Add / edit form of the `Interventions` list: the equipment is chosen when adding, unless the list is scoped to one. */
function MaintenanceFormBody({ row, equipment, scope, onSaved, onClose }: { row?: MaintenanceRow; equipment?: EquipmentRef; scope?: Record<string, string>; onSaved: () => void; onClose: () => void }) {
  const { can } = useAuth();
  return (
    <RecordForm
      label="Équipements"
      row={row}
      fields={interventionFields(can, { chooseEquipment: !scope?.equipmentId, equipment })}
      initial={row ? interventionToForm(row) : undefined}
      toPayload={(v) => {
        const { equipmentId, ...rest } = interventionPayload(v);
        return row ? rest : { equipmentId, ...rest };
      }}
      createPath="/maintenance"
      patchPath={(r) => `/maintenance/${r.id}`}
      scope={scope}
      onSaved={onSaved}
      onClose={onClose}
    />
  );
}

/**
 * Add form of an equipment's own `Interventions` tab (scope `equipmentId`): it loads the equipment (the detail page's query)
 * so that a broken one offers the same repair fields as the `Intervention` action. An edit and the page's list need none.
 */
function MaintenanceForm(props: { row?: MaintenanceRow; scope?: Record<string, string>; onSaved: () => void; onClose: () => void }) {
  const equipmentId = props.scope?.equipmentId;
  if (props.row || !equipmentId) return <MaintenanceFormBody {...props} />;
  return (
    <LoadedRecord<EquipmentDetailData> title="Ajouter — Équipements" queryKey={['/equipment', 'detail', equipmentId]} path={`/equipment/${equipmentId}`} onClose={props.onClose}>
      {(equipment) => <MaintenanceFormBody {...props} equipment={equipment} />}
    </LoadedRecord>
  );
}

/** The interventions of the equipment: a tab of the page and of an equipment's detail page (scope `equipmentId`). Master data: `update` writes. */
export const interventions: ModuleConfig<MaintenanceRow> = {
  slug: 'equipements',
  group: 'Opérations',
  title: 'Interventions',
  subtitle: 'Maintenances préventives et réparations.',
  endpoint: '/maintenance',
  columns: [
    { key: 'date', header: 'DATE', render: (m) => formatDate(m.date) },
    { key: 'equipmentName', header: 'ÉQUIPEMENT' },
    { key: 'kind', header: 'TYPE', render: (m) => maintenanceKindLabel(m.kind) },
    { key: 'description', header: 'DESCRIPTION' },
    { key: 'performedBy', header: 'INTERVENANT', render: (m) => m.performedBy ?? '—' },
    { key: 'nextDate', header: 'PROCHAINE DATE', render: (m) => (m.nextDate ? formatDate(m.nextDate) : '—') },
    { key: 'cost', header: 'COÛT', align: 'right', visible: ({ can }) => can('finance', 'read'), render: (m) => (m.cost === null ? '—' : formatMoney(m.cost)) },
  ],
  form: MaintenanceForm,
  createPermission: 'update',
  rowLabel: (m) => `${m.equipmentName} — ${m.description}`,
};
