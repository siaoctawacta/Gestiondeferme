import { Ban, CircleCheck, LockOpen, Syringe, XCircle } from 'lucide-react';
import type { ModuleConfig, RowAction, StatusDef } from '../components/module/types';
import { Pill } from '../components/ui/Pill';
import { TYPE_LABELS } from './lotsShared';
import { SPECIES_MODULE } from './productionShared';
import { stockItemOptions } from './stocksShared';
import {
  ActForm, ApplyPlanDialog, BiosecurityForm, CancelActDialog, CloseIncidentDialog, CompleteActDialog, IncidentForm,
  LiftQuarantineDialog, QuarantineForm,
} from './santeDialogs';
import {
  ACT_STATUSES, ACT_TYPES, LOG_TYPES, SEVERITIES, actTypeLabel, doneAnotherDay,
  type BiosecurityLogRow, type HealthActRow, type IncidentRow, type QuarantineRow, type VaccinationPlanRow,
} from './santeShared';

const options = <T extends { value: string; label: string }>(list: T[]) => list.map(({ value, label }) => ({ value, label }));

const TYPE_OPTIONS = ['CHAIR', 'PONDEUSE', 'POUSSIN', 'REPRODUCTEUR', 'PORCELET', 'ENGRAISSEMENT'].map((value) => ({ value, label: TYPE_LABELS[value] }));

const isOpen = (a: HealthActRow) => a.status === 'PLANIFIE' || a.status === 'EN_RETARD';

const actActions: RowAction<HealthActRow>[] = [
  // Daily entries: whoever may enter an act completes or cancels it.
  { key: 'complete', label: 'Marquer réalisé', icon: CircleCheck, permission: 'create', visible: isOpen, dialog: CompleteActDialog },
  { key: 'cancel', label: 'Annuler', icon: Ban, permission: 'create', visible: (a) => a.status !== 'ANNULE', dialog: CancelActDialog },
];

const plans: ModuleConfig<VaccinationPlanRow> = {
  slug: 'sante',
  group: 'Santé',
  title: 'Plans vaccinaux',
  subtitle: 'Programmes de vaccination appliqués aux lots.',
  endpoint: '/vaccination-plans',
  // Organisation data like the feed formulas: master rights write it from any farm view.
  farmScoped: false,
  columns: [
    { key: 'name', header: 'NOM' },
    { key: 'species', header: 'ESPÈCE', render: (p) => (p.species === 'AVICOLE' ? 'Avicole' : 'Porcin') },
    { key: 'type', header: 'TYPE DE LOT', render: (p) => (p.type ? TYPE_LABELS[p.type] ?? p.type : '—') },
    { key: 'items', header: 'ÉTAPES', render: (p) => String(p.items.length) },
  ],
  // A catalogue of the organisation: master rights, whatever the verb.
  createPermission: 'update',
  deletePermission: 'update',
  // The steps grid has four columns.
  wide: true,
  fields: [
    { name: 'name', label: 'Nom', type: 'text', required: true },
    { name: 'species', label: 'Espèce', type: 'select', required: true, defaultValue: 'AVICOLE', options: [{ value: 'AVICOLE', label: 'Avicole' }, { value: 'PORCIN', label: 'Porcin' }] },
    { name: 'type', label: 'Type de lot', type: 'select', options: TYPE_OPTIONS },
    {
      name: 'items',
      label: 'Étapes',
      type: 'lines',
      minRows: 1,
      addLabel: 'Ajouter une étape',
      defaultValue: [{ ageDays: '', productName: '', dose: '' }],
      columns: [
        { name: 'ageDays', label: 'Âge (jours)', type: 'number', required: true, min: 0, step: 1 },
        { name: 'productName', label: 'Produit', type: 'text', required: true },
        {
          name: 'stockItemId', label: 'Produit en stock', type: 'select',
          options: stockItemOptions('VACCIN'),
          // Without read rights on stocks the stored product is kept as is.
          optionsPermission: { module: 'stocks', action: 'read' },
        },
        { name: 'dose', label: 'Dose', type: 'text' },
      ],
    },
  ],
  // The lots offered belong to the plan's species module: without read on it the lot select would be empty and required.
  actions: [{
    key: 'apply', label: 'Appliquer à un lot', icon: Syringe, permission: 'update', needsFarm: true,
    visible: (p, { can }) => can(SPECIES_MODULE[p.species], 'read'), dialog: ApplyPlanDialog,
  }],
};

const biosecurity: ModuleConfig<BiosecurityLogRow> = {
  slug: 'sante',
  group: 'Santé',
  title: 'Biosécurité',
  subtitle: 'Nettoyages, désinfections, pédiluves et visiteurs.',
  endpoint: '/biosecurity-logs',
  columns: [
    { key: 'date', header: 'DATE' },
    { key: 'type', header: 'TYPE', render: (l) => LOG_TYPES.find((t) => t.value === l.type)?.label ?? l.type },
    { key: 'buildingName', header: 'BÂTIMENT' },
    { key: 'productName', header: 'PRODUIT' },
    { key: 'visitorName', header: 'VISITEUR' },
    { key: 'note', header: 'NOTE' },
  ],
  filters: [{ param: 'type', allLabel: 'Tous les types', options: options(LOG_TYPES) }],
  rowLabel: (l) => `${LOG_TYPES.find((t) => t.value === l.type)?.label ?? l.type} du ${l.date}`,
  editPermission: 'create',
  deletePermission: 'create',
  form: BiosecurityForm,
};

const QUARANTINE_STATUSES: StatusDef[] = [
  { value: 'EN_COURS', label: 'En cours', tone: 'warning' },
  { value: 'LEVEE', label: 'Levée', tone: 'success' },
];

const quarantines: ModuleConfig<QuarantineRow> = {
  slug: 'sante',
  group: 'Santé',
  title: 'Quarantaines',
  subtitle: 'Lots et animaux isolés.',
  endpoint: '/quarantines',
  columns: [
    { key: 'startDate', header: 'DÉBUT' },
    { key: 'target', header: 'LOT / ANIMAL' },
    { key: 'reason', header: 'MOTIF' },
    { key: 'endDate', header: 'FIN' },
    { key: 'status', header: 'STATUT' },
  ],
  statuses: QUARANTINE_STATUSES,
  statusKey: 'status',
  rowLabel: (q) => `${q.target} (${q.startDate})`,
  editPermission: 'create',
  deletePermission: 'create',
  canEdit: (q) => (q.status === 'LEVEE' ? 'Quarantaine levée' : true),
  form: QuarantineForm,
  actions: [{
    key: 'lift', label: 'Lever la quarantaine', icon: LockOpen, permission: 'create', visible: (q) => q.status === 'EN_COURS', dialog: LiftQuarantineDialog,
  }],
};

const INCIDENT_STATUSES: StatusDef[] = [
  { value: 'OUVERT', label: 'Ouvert', tone: 'warning' },
  { value: 'CLOS', label: 'Clos', tone: 'success' },
];

const incidents: ModuleConfig<IncidentRow> = {
  slug: 'sante',
  group: 'Santé',
  title: 'Incidents',
  subtitle: 'Événements sanitaires à suivre.',
  endpoint: '/incidents',
  columns: [
    { key: 'date', header: 'DATE' },
    { key: 'title', header: 'TITRE' },
    {
      key: 'severity',
      header: 'GRAVITÉ',
      render: (i) => {
        const s = SEVERITIES.find((x) => x.value === i.severity);
        return <Pill tone={s?.tone ?? 'neutral'}>{s?.label ?? i.severity}</Pill>;
      },
    },
    { key: 'target', header: 'CIBLE' },
    { key: 'status', header: 'STATUT' },
  ],
  statuses: INCIDENT_STATUSES,
  statusKey: 'status',
  filters: [{ param: 'severity', allLabel: 'Toutes les gravités', options: options(SEVERITIES) }],
  rowLabel: (i) => i.title,
  editPermission: 'create',
  deletePermission: 'create',
  canEdit: (i) => (i.status === 'CLOS' ? 'Incident clos' : true),
  form: IncidentForm,
  actions: [{
    key: 'close', label: "Clore l'incident", icon: XCircle, permission: 'create', visible: (i) => i.status === 'OUVERT', dialog: CloseIncidentDialog,
  }],
};

export const sante: ModuleConfig<HealthActRow> = {
  slug: 'sante',
  group: 'Santé',
  title: 'Santé & biosécurité',
  tabLabel: 'Interventions',
  subtitle: "Vaccinations, traitements, diagnostics et délais d'attente.",
  endpoint: '/health-acts',
  columns: [
    {
      key: 'date',
      header: 'DATE',
      render: (a) => (
        <>
          {a.date}
          {doneAnotherDay(a) && <span className="block text-xs font-normal text-muted-foreground">Réalisé le {a.doneDate}</span>}
        </>
      ),
    },
    { key: 'target', header: 'LOT / ANIMAL' },
    { key: 'type', header: 'TYPE', render: (a) => actTypeLabel(a.type) },
    { key: 'productName', header: 'PRODUIT' },
    { key: 'dose', header: 'DOSE' },
    { key: 'veterinarian', header: 'VÉTÉRINAIRE' },
    { key: 'status', header: 'STATUT' },
  ],
  statuses: ACT_STATUSES,
  statusKey: 'status',
  filters: [{ param: 'type', allLabel: 'Tous les types', options: options(ACT_TYPES) }],
  rowLabel: (a) => `${actTypeLabel(a.type)} du ${a.date} (${a.target})`,
  // Daily entries (a vaccination, a treatment): whoever may record one corrects or removes it.
  editPermission: 'create',
  deletePermission: 'create',
  canEdit: (a) => (a.status === 'ANNULE' ? 'Intervention annulée' : true),
  form: ActForm,
  actions: actActions,
  // On a closed lot or an exited animal the API still cancels and deletes a planned act, and refuses every other change.
  whenReadOnly: { actions: { cancel: isOpen }, canDelete: isOpen },
  tabs: [
    { key: 'plans', label: 'Plans vaccinaux', config: plans },
    { key: 'biosecurite', label: 'Biosécurité', config: biosecurity },
    { key: 'quarantaines', label: 'Quarantaines', config: quarantines },
    { key: 'incidents', label: 'Incidents', config: incidents },
  ],
};
