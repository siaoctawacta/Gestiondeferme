import { api } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { useFarmQuery } from '../../lib/query';
import { ModuleList } from '../../components/module/ModulePage';
import { Card } from '../../components/ui/Card';
import { Pill } from '../../components/ui/Pill';
import { MODULES } from '../../modules/registry';
import { customerTypeLabel, type CustomerData } from '../../modules/salesShared';
import { DetailGate } from './DetailGate';
import { DetailLayout } from './DetailLayout';

function Sheet({ data }: { data: CustomerData }) {
  const rows: [string, string | null][] = [
    ['Type', customerTypeLabel(data.type)], ['Téléphone', data.phone], ['Email', data.email], ['Ville', data.city], ['Adresse', data.address],
  ];
  return (
    <Card className="p-6">
      <dl className="grid gap-4 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-sm font-medium">{value || '—'}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** The customer's invoices: the `ventes` list embedded, scoped to this customer. */
function Invoices({ customerId }: { customerId: string }) {
  const { can } = useAuth();
  if (!can('ventes', 'read')) return <Card className="p-6 text-sm text-muted-foreground">Factures non accessibles avec votre rôle</Card>;
  return <ModuleList config={MODULES.ventes!} scope={{ customerId }} readOnly />;
}

/** `/m/clients/:id`: one customer with what was invoiced, paid, credited and is still due, and their invoices. */
export function CustomerDetail({ id }: { id: string }) {
  const query = useFarmQuery<CustomerData>(['/customers', 'detail', id], () => api.get<CustomerData>(`/customers/${id}`));
  return <DetailGate query={query}>{(c) => <Loaded c={c} />}</DetailGate>;
}

function Loaded({ c }: { c: CustomerData }) {
  return (
    <DetailLayout
      back={{ to: '/m/clients', label: 'Clients' }}
      title={c.name}
      subtitle={[c.phone, c.city].filter(Boolean).join(' · ') || undefined}
      status={
        <>
          <Pill tone="neutral">{customerTypeLabel(c.type)}</Pill>
          {!c.active && <Pill tone="danger">Inactif</Pill>}
        </>
      }
      stats={[
        { label: 'Facturé', value: formatMoney(c.invoiced) },
        { label: 'Payé', value: formatMoney(c.paid) },
        { label: 'Avoirs', value: formatMoney(c.credited) },
        { label: 'Reste dû', value: formatMoney(c.balance) },
        // What the customer is owed back is not part of the balance: shown apart, only when there is some.
        ...(c.refundDue > 0 ? [{ label: 'À rembourser', value: formatMoney(c.refundDue) }] : []),
      ]}
      tabs={[
        { key: 'invoices', label: 'Factures', content: <Invoices customerId={c.id} /> },
        { key: 'sheet', label: 'Fiche', content: <Sheet data={c} /> },
      ]}
    />
  );
}
