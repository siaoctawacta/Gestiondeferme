import { useState, type FormEvent } from 'react';
import { allPages } from '../components/module/allPages';
import { changedFields } from '../components/module/changedFields';
import { errorMessage } from '../components/module/errorMessage';
import { RecordForm } from '../components/module/RecordForm';
import type { LineRow, ModuleConfig } from '../components/module/types';
import { useEndpointOptions, type Option } from '../components/module/useEndpointOptions';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Dialog, DialogActions } from '../components/ui/Dialog';
import { Field } from '../components/ui/Field';
import { Pill } from '../components/ui/Pill';
import { Segmented } from '../components/ui/Segmented';
import { Select } from '../components/ui/Select';
import { api } from '../lib/api';
import { formatMoney, formatNumber, orDash, todayIso } from '../lib/format';
import { useFarmQuery } from '../lib/query';
import { useBuildingOptions, useOpenLotOptions } from './productionShared';
import { stockItemOptions } from './stocksShared';

/* ---------------------------------------------------------------------------------------------
 * API shapes (backend contract of `/feed-distributions`, `/feed-products`, `/feed-formulas`).
 * ------------------------------------------------------------------------------------------- */

/**
 * `GET /feed-distributions`. `waterLiters` is set on the first distribution of a target and date only;
 * `waterEditable` (newer API) says whether this row may carry the day's water.
 */
export interface FeedDistribution {
  id: string;
  /** `YYYY-MM-DD` */
  date: string;
  /** Lot code or building name. */
  target: string;
  targetKind: 'LOT' | 'BATIMENT';
  batchId: string | null;
  buildingId: string | null;
  feedName: string;
  feedProductId: string | null;
  formulaId: string | null;
  quantityKg: number;
  waterLiters: number | null;
  /** Absent on older APIs: then only a row that already has water is editable. */
  waterEditable?: boolean;
  /** Null without `finance:read`. */
  unitCost: number | null;
  cost: number | null;
  note: string | null;
}

export type FeedKind = 'MATIERE_PREMIERE' | 'ALIMENT_COMPLET';

/** `GET /feed-products`. */
export interface FeedProduct {
  id: string;
  name: string;
  kind: FeedKind;
  unit: string;
  unitCost: number;
  active: boolean;
  /** Stock article this feed draws from (`GET /stock-items`, category ALIMENT); absent on an API without stock. */
  stockItemId?: string | null;
}

/** `GET /feed-formulas`. */
export interface FeedFormula {
  id: string;
  name: string;
  species: 'AVICOLE' | 'PORCIN';
  stage: string;
  active: boolean;
  costPerKg: number;
  items: { feedProductId: string; name: string; percentage: number; unitCost: number }[];
}

/* --------------------------------------------------------------------------------------------- */

const SPECIES = [
  { value: 'AVICOLE', label: 'Avicole' },
  { value: 'PORCIN', label: 'Porcin' },
] as const;

const KINDS = [
  { value: 'MATIERE_PREMIERE', label: 'Matière première' },
  { value: 'ALIMENT_COMPLET', label: 'Aliment complet' },
];

const activePill = (active: boolean) => <Pill tone={active ? 'success' : 'neutral'}>{active ? 'Actif' : 'Inactif'}</Pill>;
const LABEL = 'block text-sm font-medium';
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Options plus the value already stored on a record (it may be inactive or out of the loaded set). */
const withStored = (options: Option[], stored: Option | null): Option[] =>
  stored && !options.some((o) => o.value === stored.value) ? [stored, ...options] : options;

function SelectField({
  label, value, options, onChange, disabled, placeholder = 'Sélectionner…',
}: { label: string; value: string; options: Option[]; onChange: (v: string) => void; disabled?: boolean; placeholder?: string }) {
  return (
    <Select aria-label={label} className="w-full" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Select>
  );
}

type FormProps<T> = { row?: T; scope?: Record<string, string>; onSaved: () => void; onClose: () => void };

/**
 * Add / edit a distribution. The target (lot or building) and the feed (product or formula) are each a choice
 * between two kinds, then a select. Inside a lot (`scope.batchId`) the target is fixed and not shown; an existing
 * record keeps its target (the API does not move a distribution). Water, when given, is recorded for the same
 * target and day.
 */
function DistributionForm({ row, scope, onSaved, onClose }: FormProps<FeedDistribution>) {
  const lotFixed = Boolean(scope?.batchId);
  const [date, setDate] = useState(row?.date ?? todayIso());
  const [targetKind, setTargetKind] = useState<'LOT' | 'BATIMENT'>(row?.targetKind ?? 'LOT');
  const [targetId, setTargetId] = useState(row?.batchId ?? row?.buildingId ?? '');
  const [feedKind, setFeedKind] = useState<'PRODUIT' | 'FORMULE'>(row?.formulaId ? 'FORMULE' : 'PRODUIT');
  const storedKind = row?.formulaId ? 'FORMULE' : 'PRODUIT';
  const storedFeedId = row?.feedProductId ?? row?.formulaId ?? '';
  const [feedId, setFeedId] = useState(storedFeedId);
  const [quantity, setQuantity] = useState(row ? String(row.quantityKg) : '');
  const [water, setWater] = useState(row?.waterLiters != null ? String(row.waterLiters) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const picking = !row && !lotFixed;
  const lots = useOpenLotOptions(picking && targetKind === 'LOT');
  const buildings = useBuildingOptions(undefined, picking && targetKind === 'BATIMENT');
  const products = useEndpointOptions({ endpoint: '/feed-products', params: { active: 'true' } }, undefined, feedKind === 'PRODUIT');
  const formulas = useEndpointOptions({ endpoint: '/feed-formulas', params: { active: 'true' } }, undefined, feedKind === 'FORMULE');

  const storedTarget = row ? { value: row.batchId ?? row.buildingId ?? '', label: row.target } : null;
  const targetOptions = withStored(targetKind === 'LOT' ? lots : buildings, storedTarget);
  const storedFeed = row ? { value: storedFeedId, label: row.feedName } : null;
  const feedOptions = withStored(feedKind === 'PRODUIT' ? products : formulas, row && feedKind === storedKind ? storedFeed : null);
  // Only the first distribution of a target and day carries the day's water. The API says so (`waterEditable`);
  // an older one does not, and then a row without water is locked.
  const waterLocked = Boolean(row) && (row?.waterEditable !== undefined ? !row.waterEditable : row?.waterLiters === null);
  const canClearWater = row?.waterEditable === true;
  const targetLabel = targetKind === 'LOT' ? 'Lot' : 'Bâtiment';
  const feedLabel = feedKind === 'PRODUIT' ? 'Aliment' : 'Formule';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const qty = Number(quantity);
    const liters = Number(water);
    if (!date) return setError('Le champ « Date » est requis');
    if (picking && !targetId) return setError(`Le champ « ${targetLabel} » est requis`);
    // An edit keeps the stored feed (even one no longer selectable) unless the kind was changed and no new feed picked.
    const feedNow = feedId || (row && feedKind === storedKind ? storedFeedId : '');
    if (!feedNow) return setError(`Le champ « ${feedLabel} » est requis`);
    if (quantity.trim() === '' || !(qty > 0)) return setError('La quantité doit être un nombre positif');
    if (!waterLocked && water.trim() !== '' && !(liters > 0)) return setError("Le volume d'eau doit être un nombre positif");
    // Older APIs cannot clear a day's water through a distribution.
    if (row && !waterLocked && !canClearWater && water.trim() === '' && row.waterLiters !== null) {
      return setError("La consommation d'eau ne peut pas être vidée ici");
    }

    const feed = feedKind === 'PRODUIT' ? { feedProductId: feedNow } : { formulaId: feedNow };
    setBusy(true);
    setError(null);
    try {
      if (!row) {
        const target = targetKind === 'LOT' ? { batchId: targetId } : { buildingId: targetId };
        await api.post('/feed-distributions', {
          date, ...(lotFixed ? {} : target), ...feed, quantityKg: qty, ...(water.trim() === '' ? {} : { waterLiters: liters }), ...scope,
        });
      } else {
        const body = changedFields(
          { date: row.date, quantityKg: row.quantityKg, ...(waterLocked ? {} : { waterLiters: row.waterLiters ?? undefined }) },
          { date, quantityKg: qty, ...(waterLocked ? {} : { waterLiters: water.trim() === '' ? undefined : liters }) },
        );
        // An unchanged feed is not resent: the stored unit cost stays.
        if (feedNow !== storedFeedId) Object.assign(body, feed);
        if (Object.keys(body).length > 0) await api.patch(`/feed-distributions/${row.id}`, body);
      }
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={`${row ? 'Modifier' : 'Ajouter'} — Alimentation & eau`}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field label="Date" type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
        {!lotFixed && (
          <div className="space-y-1.5">
            <span className={LABEL}>Cible</span>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                label="Type de cible"
                value={targetKind}
                disabled={Boolean(row)}
                options={[{ value: 'LOT', label: 'Lot' }, { value: 'BATIMENT', label: 'Bâtiment' }]}
                onChange={(k) => { setTargetKind(k); setTargetId(''); }}
              />
              <div className="min-w-48 flex-1">
                <SelectField label={targetLabel} value={targetId} options={targetOptions} onChange={setTargetId} disabled={Boolean(row)} />
              </div>
            </div>
          </div>
        )}
        <div className="space-y-1.5">
          <span className={LABEL}>Aliment</span>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label="Type d'aliment"
              value={feedKind}
              options={[{ value: 'PRODUIT', label: 'Aliment' }, { value: 'FORMULE', label: 'Formule' }]}
              onChange={(k) => { setFeedKind(k); setFeedId(row && k === storedKind ? storedFeedId : ''); }}
            />
            <div className="min-w-48 flex-1">
              <SelectField label={feedLabel} value={feedId} options={feedOptions} onChange={setFeedId} />
            </div>
          </div>
        </div>
        <Field label="Quantité (kg)" type="number" min={0} step={0.01} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        <Field
          label="Eau (L)"
          type="number"
          min={0}
          step={0.01}
          value={water}
          disabled={waterLocked}
          onChange={(e) => setWater(e.target.value)}
          hint={waterLocked ? "La consommation d'eau du jour est portée par la première distribution" : "Eau du jour pour cette cible (une seule valeur par jour)"}
        />
        {error && <Alert>{error}</Alert>}
        <DialogActions>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button type="submit" disabled={busy}>Enregistrer</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

/** Hundredths of a percent, so sums are exact. */
const hundredths = (s: string) => Math.round(Number(s || 0) * 100);
const totalHundredths = (rows: LineRow[]) => rows.reduce((sum, r) => sum + hundredths(r.percentage ?? ''), 0);
const isComplete = (rows: LineRow[]) => Math.abs(totalHundredths(rows) - 10000) <= 1;
/** `100%` when exact, else up to two decimals (`99.95%`), so the total never reads 100 % while the line says it falls short. */
const showTotal = (h: number) => `${+(h / 100).toFixed(2)}%`;

/**
 * Add / edit a formula: name, species, stage and ingredient lines (a `lines` field: product + percentage). The
 * running total must reach 100 %; `Coût / kg` follows the selected products' unit costs as lines change.
 */
function FormulaForm({ row, onSaved, onClose }: FormProps<FeedFormula>) {
  const products = useFarmQuery<FeedProduct[]>(['/feed-products', 'all'], () => allPages<FeedProduct>('/feed-products'));
  const catalogue = products.data ?? [];
  const byId = new Map(catalogue.map((p) => [p.id, p]));
  // An inactive product is not offered for a new line, but a formula already using it keeps it.
  const stored = new Set(row?.items.map((i) => i.feedProductId));
  const productOptions: Option[] = catalogue.filter((p) => p.active || stored.has(p.id)).map((p) => ({ value: p.id, label: p.name }));

  const footer = (rows: LineRow[]) => {
    const complete = isComplete(rows);
    const costPerKg = round2(rows.reduce((sum, r) => sum + (Number(r.percentage || 0) * (byId.get(r.feedProductId ?? '')?.unitCost ?? 0)) / 100, 0));
    return (
      <div className="w-full space-y-2">
        <p data-testid="formula-total" className={`text-sm font-medium ${complete ? 'text-accent-foreground' : 'text-warning-foreground'}`}>
          Total : {showTotal(totalHundredths(rows))}{complete ? '' : ' (doit atteindre 100%)'}
        </p>
        <p className="flex items-baseline justify-between rounded-2xl bg-muted px-4 py-2 text-sm">
          <span className="font-medium">Coût / kg</span>
          <span data-testid="formula-cost" className="font-display text-lg font-bold">{formatMoney(costPerKg)}</span>
        </p>
      </div>
    );
  };

  return (
    <RecordForm
      label="Formules"
      row={row}
      initial={row as unknown as Record<string, unknown> | undefined}
      intro={products.isError ? <Alert>{errorMessage(products.error)}</Alert> : undefined}
      fields={[
        { name: 'name', label: 'Nom', type: 'text', required: true },
        { name: 'species', label: 'Espèce', type: 'select', required: true, defaultValue: 'AVICOLE', options: [...SPECIES] },
        { name: 'stage', label: 'Stade', type: 'text', required: true },
        {
          name: 'items',
          label: 'Composition',
          type: 'lines',
          minRows: 1,
          defaultValue: [{ feedProductId: '', percentage: '' }],
          columns: [
            { name: 'feedProductId', label: 'Aliment', type: 'select', required: true, unique: true, options: productOptions },
            { name: 'percentage', label: 'Pourcentage', type: 'number', required: true, min: 0.01, max: 100, step: 0.01 },
          ],
          footer,
        },
        { name: 'active', label: 'Actif', type: 'checkbox', defaultValue: true },
      ]}
      validate={(v) => (isComplete(v.items as LineRow[]) ? null : 'Les pourcentages doivent totaliser 100 %')}
      createPath="/feed-formulas"
      patchPath={(r) => `/feed-formulas/${r.id}`}
      onSaved={onSaved}
      onClose={onClose}
    />
  );
}

/** The `Aliments` tab: products of the organisation (no farm in the URL, so writes stay possible under "all farms"). */
export const feedProducts: ModuleConfig<FeedProduct> = {
  slug: 'alimentation',
  group: 'Production',
  title: 'Aliments',
  subtitle: 'Matières premières et aliments complets.',
  endpoint: '/feed-products',
  farmScoped: false,
  createPermission: 'update',
  columns: [
    { key: 'name', header: 'NOM', sortable: true },
    { key: 'kind', header: 'TYPE', render: (p) => KINDS.find((k) => k.value === p.kind)?.label ?? p.kind },
    { key: 'unitCost', header: 'COÛT UNITAIRE', sortable: true, render: (p) => `${formatMoney(p.unitCost)}/kg` },
    { key: 'active', header: 'ACTIF', render: (p) => activePill(p.active) },
  ],
  fields: [
    { name: 'name', label: 'Nom', type: 'text', required: true },
    { name: 'kind', label: 'Type', type: 'select', required: true, options: KINDS },
    { name: 'unitCost', label: 'Coût unitaire (FCFA/kg)', type: 'number', required: true, min: 0, step: 0.01 },
    { name: 'stockItemId', label: 'Article de stock', type: 'select', options: stockItemOptions('ALIMENT') },
    { name: 'active', label: 'Actif', type: 'checkbox', defaultValue: true },
  ],
};

/** The `Formules` tab: recipes with their cost per kg. */
export const feedFormulas: ModuleConfig<FeedFormula> = {
  slug: 'alimentation',
  group: 'Production',
  title: 'Formules',
  subtitle: "Formules d'aliment et coût au kilo.",
  endpoint: '/feed-formulas',
  farmScoped: false,
  createPermission: 'update',
  columns: [
    { key: 'name', header: 'NOM', sortable: true },
    { key: 'species', header: 'ESPÈCE', render: (f) => SPECIES.find((s) => s.value === f.species)?.label ?? f.species },
    { key: 'stage', header: 'STADE', sortable: true },
    { key: 'costPerKg', header: 'COÛT / KG', render: (f) => formatMoney(f.costPerKg) },
    { key: 'active', header: 'ACTIF', render: (f) => activePill(f.active) },
  ],
  form: FormulaForm,
};

export const alimentation: ModuleConfig<FeedDistribution> = {
  slug: 'alimentation',
  group: 'Production',
  title: 'Alimentation & eau',
  tabLabel: 'Distributions',
  subtitle: "Distributions d'aliment et consommation d'eau par lot.",
  endpoint: '/feed-distributions',
  columns: [
    { key: 'date', header: 'DATE', sortable: true },
    { key: 'target', header: 'LOT / BÂTIMENT' },
    { key: 'feedName', header: 'ALIMENT' },
    { key: 'quantityKg', header: 'ALIMENT (KG)', sortable: true, render: (d) => formatNumber(d.quantityKg) },
    { key: 'waterLiters', header: 'EAU (L)', render: (d) => orDash(d.waterLiters) },
    { key: 'cost', header: 'COÛT', visible: ({ can }) => can('finance', 'read'), render: (d) => (d.cost === null ? '—' : formatMoney(d.cost)) },
  ],
  rowLabel: (d) => `${d.target} du ${d.date}`,
  editPermission: 'create',
  deletePermission: 'create',
  form: DistributionForm,
  tabs: [
    { key: 'aliments', label: 'Aliments', config: feedProducts },
    { key: 'formules', label: 'Formules', config: feedFormulas },
  ],
};
