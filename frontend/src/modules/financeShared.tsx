import { useId, useState } from 'react';
import { Link } from 'react-router';
import { errorMessage } from '../components/module/errorMessage';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { api } from '../lib/api';
import { Card } from '../components/ui/Card';
import { Pill, type PillTone } from '../components/ui/Pill';
import { useAuth } from '../lib/auth';
import type { ModuleKey } from '../lib/modules';
import { formatMoney, signedMoney, todayIso } from '../lib/format';
import type { PayrollPreview } from './personnelShared';
import { ACTIVITIES, activityLabel } from './purchasingShared';

/* ---------------------------------------------------------------------------------------------
 * API shapes (backend contract of `/finance/*`, Task 6). Reconcile with the backend here only.
 * ------------------------------------------------------------------------------------------- */

export type FinanceKind = 'DEPENSE' | 'RECETTE';

/** Where a row of the ledger comes from: a manual entry, or a document (purchase, lot purchase price, invoice, credit note, maintenance intervention). */
export type FinanceOrigin = 'MANUEL' | 'ACHAT' | 'LOT' | 'FACTURE' | 'AVOIR' | 'MAINTENANCE';

/**
 * `GET /finance/entries`. A derived row (`editable: false`) is made by its document: `sourceId` is that document's id
 * (the purchase, the lot, the invoice; a credit note's own id, which has no page, so it is not linked). `activity` /
 * `category` are the enum values. `note` is carried by the list so that a manual entry can be edited without loading it.
 */
export interface FinanceEntryRow {
  id: string;
  origin: FinanceOrigin;
  sourceId: string | null;
  /** A `MAINTENANCE` row: the equipment of the intervention, when the API names it (`sourceId` is the intervention's id). */
  equipmentId?: string | null;
  /** `YYYY-MM-DD` */
  date: string;
  label: string;
  kind: FinanceKind;
  activity: string;
  category: string;
  /** Negative for a credit note (a negative revenue). */
  amount: number;
  batchId: string | null;
  batchCode: string | null;
  note?: string | null;
  editable: boolean;
}

/** One activity of the summary (`activity` is the enum, labelled by the UI; every figure is the API's, the margin too). */
export interface ActivitySummary {
  activity: string;
  revenue: number;
  expenses: number;
  margin: number;
}

/** `GET /finance/summary`. `byFarm` is only present under "all farms". */
export interface FinanceSummaryDto {
  from: string;
  to: string;
  revenue: number;
  expenses: number;
  margin: number;
  marginPct: number | null;
  receivables: number;
  byActivity: ActivitySummary[];
  byCategory: { kind: FinanceKind; category: string; label: string; amount: number }[];
  byFarm?: { farmId: string; farmName: string; revenue: number; expenses: number; margin: number }[];
}

/** `GET /finance/lots` (and `/finance/lots/:batchId`): the analytic view of one lot. `id` is the lot's id (= `batchId`). */
export interface LotProfitRow {
  id: string;
  batchId: string;
  code: string;
  species: 'AVICOLE' | 'PORCIN';
  type: string;
  status: string;
  animals: number;
  sold: number;
  alive: number;
  costs: { animaux: number; aliment: number; sante: number; autres: number };
  totalCost: number;
  revenue: number;
  margin: number;
  costPerAnimal: number | null;
  costPerKg: number | null;
}

/* --------------------------------------------------------------------------------------------- */

export const KINDS: { value: FinanceKind; label: string }[] = [
  { value: 'DEPENSE', label: 'Dépense' },
  { value: 'RECETTE', label: 'Recette' },
];
export const entryKindLabel = (k: string) => KINDS.find((x) => x.value === k)?.label ?? k;

export { ACTIVITIES, activityLabel };

/** The fixed categories of the owner's ruling (Q21), in the order the screens list them. */
export const EXPENSE_CATEGORIES = [
  { value: 'ANIMAUX', label: 'Animaux' },
  { value: 'ALIMENT', label: 'Aliment' },
  { value: 'SANTE', label: 'Santé' },
  { value: 'MATERIEL', label: 'Matériel' },
  { value: 'CONSOMMABLES', label: 'Consommables' },
  { value: 'SALAIRES', label: 'Salaires' },
  { value: 'ENERGIE', label: 'Énergie' },
  { value: 'EAU', label: 'Eau' },
  { value: 'TRANSPORT', label: 'Transport' },
  { value: 'ENTRETIEN', label: 'Entretien' },
  { value: 'AUTRE_CHARGE', label: 'Autres charges' },
];
export const REVENUE_CATEGORIES = [
  { value: 'VENTE_ANIMAUX', label: "Ventes d'animaux" },
  { value: 'VENTE_OEUFS', label: "Ventes d'œufs" },
  { value: 'VENTE_ARTICLES', label: "Ventes d'articles" },
  { value: 'PRESTATIONS', label: 'Prestations' },
  { value: 'AUTRE_RECETTE', label: 'Autres recettes' },
];
export const categoriesOf = (kind: string) => (kind === 'RECETTE' ? REVENUE_CATEGORIES : EXPENSE_CATEGORIES);
export const categoryLabel = (c: string) => [...EXPENSE_CATEGORIES, ...REVENUE_CATEGORIES].find((x) => x.value === c)?.label ?? c;

/** Why a derived row is locked (`by`: its origin, as it reads after `Écriture générée par`), and where its document is. */
type OriginInfo = { by: string; path?: (id: string | null, row: FinanceEntryRow) => string | null; module: (row: FinanceEntryRow) => ModuleKey | null };
const ORIGINS: Record<Exclude<FinanceOrigin, 'MANUEL'>, OriginInfo> = {
  ACHAT: { by: 'un achat', path: (id) => `/m/achats/${id}`, module: () => 'achats' },
  // The detail of a pig lot is served under `porcs`.
  LOT: {
    by: "l'achat d'un lot",
    path: (id, r) => (r.activity === 'PORCIN' ? `/m/porcs/lot-${id}` : `/m/lots/${id}`),
    module: (r) => (r.activity === 'PORCIN' ? 'porcs' : 'lots'),
  },
  FACTURE: { by: 'une facture', path: (id) => `/m/ventes/${id}`, module: () => 'ventes' },
  // A credit note has no page of its own: it is read on its invoice, which the row does not name.
  AVOIR: { by: 'un avoir', module: () => 'ventes' },
  // An intervention has no page of its own: the row opens its equipment (the module's list when the row does not name it).
  MAINTENANCE: { by: 'une intervention', path: (_id, r) => (r.equipmentId ? `/m/equipements/${r.equipmentId}` : '/m/equipements'), module: () => 'equipements' },
};
/** Neutral stand-in for an origin this screen does not know (a newer backend): read-only, no link, no crash. */
const UNKNOWN_ORIGIN: OriginInfo = { by: 'un autre document', module: () => null };
const originOf = (row: FinanceEntryRow): OriginInfo => (ORIGINS as Record<string, OriginInfo | undefined>)[row.origin] ?? UNKNOWN_ORIGIN;

/** The tooltip of the disabled edit / delete icons of a derived row. */
export const lockedReason = (row: FinanceEntryRow): true | string =>
  row.editable || row.origin === 'MANUEL' ? true : `Écriture générée par ${originOf(row).by} — corrigez le document d'origine`;

/** The label of a row; a derived one links to its document when the API names it and the user may read its module. */
export function EntryLabel({ row }: { row: FinanceEntryRow }) {
  const { can } = useAuth();
  if (row.origin === 'MANUEL') return <>{row.label}</>;
  const origin = originOf(row);
  const module = origin.module(row);
  const to = row.sourceId && module && can(module, 'read') ? origin.path?.(row.sourceId, row) : null;
  return to ? <Link to={to} className="hover:underline">{row.label}</Link> : <>{row.label}</>;
}

/** The `MONTANT` pill: a `Dépense` in danger, a `Recette` in success, a negative revenue (a credit note) in danger. */
export function AmountPill({ row }: { row: Pick<FinanceEntryRow, 'kind' | 'amount'> }) {
  const tone: PillTone = row.kind === 'DEPENSE' || row.amount < 0 ? 'danger' : 'success';
  return <Pill tone={tone}>{signedMoney(row.amount)}</Pill>;
}

/** A margin: success from zero up, danger below. */
export function MarginPill({ value }: { value: number }) {
  return <Pill tone={value >= 0 ? 'success' : 'danger'}>{signedMoney(value)}</Pill>;
}

/**
 * The two views never add up (no double counting): the farm view counts what was bought, the lot view what the lot
 * consumed. Both screens say so.
 */
export const SUMS_HINT =
  'La « Marge » de la ferme (recettes − dépenses) et la « Marge du lot » de la rentabilité par lot sont deux vues différentes : leurs sommes ne sont pas censées concorder.';

/** One card per activity, as the reports screen shows them: its margin, then its revenue and expenses, all from the API. */
export function ActivityCards({ rows }: { rows: ActivitySummary[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {rows.map((a) => (
        <Card key={a.activity} className="p-5">
          <p className="text-sm text-muted-foreground">Activité {activityLabel(a.activity)}</p>
          <p className="mt-2 font-display text-[28px] font-bold leading-9">{signedMoney(a.margin)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Recettes {signedMoney(a.revenue)} · Dépenses {formatMoney(a.expenses)}
          </p>
        </Card>
      ))}
    </div>
  );
}

/**
 * The salary entry of a month, as the form's initial values: `Salaires octobre 2026`, an expense of the General
 * activity, category Salaires, the payroll total, dated the month's last day (today for the current month).
 */
export function payrollEntry(p: PayrollPreview): Record<string, unknown> {
  const [year, month] = p.month.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return {
    date: p.month === todayIso().slice(0, 7) ? todayIso() : last,
    kind: 'DEPENSE', label: p.label, activity: 'GENERAL', category: 'SALAIRES', amount: p.total,
  };
}

/**
 * State of `Salaires du mois` (`finance:create`): the month, the preview read from `GET /employees/payroll?month=` and the
 * prefilled entry handed to `onPrefill`. It lives in the form that owns the dialog, which restarts from the prefilled values.
 * When the month already has its salary entry the preview says so, and the entry can still be posted.
 */
export function usePayrollPicker(onPrefill: (values: Record<string, unknown>) => void) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => todayIso().slice(0, 7));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<string | null>(null);

  const load = async () => {
    setBusy(true);
    setError(null);
    setExisting(null);
    try {
      const preview = await api.get<PayrollPreview>('/employees/payroll', { month });
      if (preview.existing) setExisting(`Une écriture « ${preview.label} » de ${formatMoney(preview.existing.amount)} existe déjà pour ce mois.`);
      onPrefill(payrollEntry(preview));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return { open, setOpen, month, setMonth, busy, error, existing, load };
}

/** The `Salaires du mois` button of the entry form, its month input and what the preview said. */
export function PayrollPicker({ picker: { open, setOpen, month, setMonth, busy, error, existing, load } }: { picker: ReturnType<typeof usePayrollPicker> }) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Button variant="outline" onClick={() => setOpen(!open)} aria-expanded={open}>Salaires du mois</Button>
      {open && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <label htmlFor={id} className="block text-sm font-medium text-foreground">Mois des salaires</label>
            <Input id={id} type="month" max={todayIso().slice(0, 7)} value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <Button onClick={load} disabled={busy || month === ''}>Pré-remplir</Button>
        </div>
      )}
      {error && <Alert>{error}</Alert>}
      {existing && <div role="status" className="rounded-2xl bg-warning/15 px-4 py-2 text-sm text-foreground">{existing}</div>}
    </div>
  );
}
