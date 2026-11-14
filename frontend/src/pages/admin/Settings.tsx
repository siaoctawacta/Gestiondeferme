import { useId, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ErrorRetry } from '../../components/module/ErrorRetry';
import { errorMessage } from '../../components/module/errorMessage';
import { PageHeader } from '../../components/module/PageHeader';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { farmKey, useFarmQuery } from '../../lib/query';

type Legal = Record<'name' | 'address' | 'nif' | 'rccm', string>;
type SettingsData = Record<string, number | string | Legal>;

interface SettingField {
  key: string;
  /** For the `legal` object: the property edited by this field. */
  sub?: keyof Legal;
  label: string;
  kind: 'number' | 'text';
}

const GROUPS: { title: string; fields: SettingField[] }[] = [
  {
    title: "Seuils d'alerte",
    fields: [
      { key: 'mortalityDailyPct', label: 'Mortalité journalière (%)', kind: 'number' },
      { key: 'mortalityCumulPct', label: 'Mortalité cumulée (%)', kind: 'number' },
      { key: 'consumptionDeviationPct', label: 'Écart de consommation (%)', kind: 'number' },
      { key: 'expiryWarningDays', label: 'Alerte de péremption (jours)', kind: 'number' },
    ],
  },
  {
    title: 'Reproduction',
    fields: [
      { key: 'farrowingWarningDays', label: 'Alerte de mise bas (jours)', kind: 'number' },
      { key: 'gestationDays', label: 'Durée de gestation (jours)', kind: 'number' },
    ],
  },
  {
    title: 'Mentions légales',
    fields: [
      { key: 'legal', sub: 'name', label: 'Raison sociale', kind: 'text' },
      { key: 'legal', sub: 'address', label: 'Adresse', kind: 'text' },
      { key: 'legal', sub: 'nif', label: 'NIF', kind: 'text' },
      { key: 'legal', sub: 'rccm', label: 'RCCM', kind: 'text' },
    ],
  },
  { title: 'Devise', fields: [{ key: 'currency', label: 'Devise', kind: 'text' }] },
];

const fieldId = (f: SettingField) => (f.sub ? `${f.key}.${f.sub}` : f.key);

function readValue(data: SettingsData, f: SettingField): string {
  const v = f.sub ? (data[f.key] as Legal)[f.sub] : data[f.key];
  return String(v ?? '');
}

/** One PUT body per setting key; the legal fields are sent together as one object. */
function toRequests(fields: SettingField[], values: Record<string, string>): [string, unknown][] {
  const out = new Map<string, unknown>();
  for (const f of fields) {
    const raw = values[fieldId(f)];
    if (f.sub) {
      const legal = (out.get(f.key) ?? {}) as Record<string, string>;
      legal[f.sub] = raw;
      out.set(f.key, legal);
    } else {
      out.set(f.key, f.kind === 'number' ? Number(raw) : raw.trim());
    }
  }
  return [...out];
}

function SettingInput({ field, value, readOnly, onChange }: {
  field: SettingField; value: string; readOnly: boolean; onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">{field.label}</label>
      <Input
        id={id}
        type={field.kind === 'number' ? 'number' : 'text'}
        step={field.kind === 'number' ? 'any' : undefined}
        readOnly={readOnly}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function SettingsCard({ title, fields, data, canEdit }: {
  title: string; fields: SettingField[]; data: SettingsData; canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const { farmId } = useAuth();
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(fields.map((f) => [fieldId(f), readValue(data, f)])),
  );
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    // A cleared number field would be sent as 0: ask for a value instead.
    const missing = fields.find((f) => f.kind === 'number' && !Number.isFinite(parseFloat(values[fieldId(f)])));
    if (missing) {
      setFeedback({ tone: 'error', message: `Le champ « ${missing.label} » est requis et doit être un nombre` });
      return;
    }
    setSaving(true);
    try {
      for (const [key, value] of toRequests(fields, values)) await api.put(`/settings/${key}`, { value });
      setFeedback({ tone: 'success', message: 'Paramètres enregistrés' });
      void queryClient.invalidateQueries({ queryKey: farmKey(farmId, 'settings') });
    } catch (err) {
      setFeedback({ tone: 'error', message: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-6">
      <form onSubmit={save} className="space-y-4">
        <h2 className="text-lg font-bold">{title}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((f) => (
            <SettingInput
              key={fieldId(f)}
              field={f}
              value={values[fieldId(f)]}
              readOnly={!canEdit}
              onChange={(v) => setValues((s) => ({ ...s, [fieldId(f)]: v }))}
            />
          ))}
        </div>
        {feedback && <Alert tone={feedback.tone}>{feedback.message}</Alert>}
        {canEdit && (
          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>Enregistrer</Button>
          </div>
        )}
      </form>
    </Card>
  );
}

export default function Settings() {
  const { can } = useAuth();
  const settings = useFarmQuery<SettingsData>(['settings'], () => api.get<SettingsData>('/settings'));

  return (
    <>
      <PageHeader
        group="Administration"
        title="Paramètres"
        subtitle="Seuils d’alerte, reproduction, mentions légales et devise."
      />
      {settings.isError && (
        <ErrorRetry message={errorMessage(settings.error)} onRetry={() => settings.refetch()} />
      )}
      {settings.isPending && <div role="status" aria-label="Chargement" className="h-40 animate-pulse rounded-3xl bg-muted" />}
      {settings.data && (
        <div className="space-y-4">
          {GROUPS.map((g) => (
            <SettingsCard key={g.title} title={g.title} fields={g.fields} data={settings.data} canEdit={can('parametres', 'update')} />
          ))}
        </div>
      )}
    </>
  );
}
