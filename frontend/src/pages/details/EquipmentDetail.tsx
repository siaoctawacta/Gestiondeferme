import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, formatMoney } from '../../lib/format';
import { farmKey, useFarmQuery } from '../../lib/query';
import { ModuleList } from '../../components/module/ModulePage';
import { QrButton } from '../../components/module/QrButton';
import { canRunAction } from '../../components/module/rowActions';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Pill } from '../../components/ui/Pill';
import { Table, TD, TH, THead, TR } from '../../components/ui/Table';
import { EQUIPMENT_ACTIONS } from '../../modules/equipmentActions';
import {
  CONDITIONS, EQUIPMENT_RETIRED, equipmentTypeLabel, interventions, type BreakdownRow, type EquipmentDetailData,
} from '../../modules/equipementsShared';
import { MODULES } from '../../modules/registry';
import { DetailGate } from './DetailGate';
import { DetailLayout } from './DetailLayout';

function BreakdownsTab({ breakdowns }: { breakdowns: BreakdownRow[] }) {
  return (
    <Card className="overflow-hidden">
      <Table>
        <THead>
          <TR className="border-b!">
            {['DATE', 'DESCRIPTION', 'RÉPARÉE LE'].map((h) => <TH key={h}>{h}</TH>)}
          </TR>
        </THead>
        <tbody>
          {breakdowns.length === 0 && <TR><TD colSpan={3} className="py-10 text-center text-muted-foreground">Aucune panne</TD></TR>}
          {breakdowns.map((b) => (
            <TR key={b.id}>
              <TD>{formatDate(b.date)}</TD>
              <TD>{b.description}</TD>
              <TD>{b.resolvedDate ? formatDate(b.resolvedDate) : '—'}</TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

/** `/m/equipements/:id`: one equipment with its key figures, interventions, breakdowns and tasks; the same actions as its list row. */
export function EquipmentDetail({ id }: { id: string }) {
  const { can, farmId } = useAuth();
  const queryClient = useQueryClient();
  const [acting, setActing] = useState<string | null>(null);
  const query = useFarmQuery<EquipmentDetailData>(['/equipment', 'detail', id], () => api.get<EquipmentDetailData>(`/equipment/${id}`));
  const refresh = () => void queryClient.invalidateQueries({ queryKey: farmKey(farmId) });
  const writable = farmId !== 'all';

  return (
    <DetailGate query={query}>
      {(data) => {
        const condition = CONDITIONS.find((c) => c.value === data.condition);
        const offered = EQUIPMENT_ACTIONS.filter((a) => canRunAction(a.permission, 'equipements', can, writable) && a.visible(data));
        const Dialog = EQUIPMENT_ACTIONS.find((a) => a.key === acting)?.Dialog;
        const tasks = can('taches', 'read') ? MODULES.taches : undefined;
        const readOnly = data.retiredAt ? EQUIPMENT_RETIRED : false;
        return (
          <>
            <DetailLayout
              back={{ to: '/m/equipements', label: 'Équipements' }}
              title={data.name}
              subtitle={[equipmentTypeLabel(data.type), data.location].filter(Boolean).join(' · ')}
              status={<Pill tone={condition?.tone ?? 'neutral'}>{condition?.label ?? data.condition}</Pill>}
              actions={
                <>
                  {offered.map((a) => (
                    <Button key={a.key} variant="outline" onClick={() => setActing(a.key)}>{a.label}</Button>
                  ))}
                  <QrButton kind="equipement" id={id} />
                </>
              }
              stats={[
                { label: 'Prochaine maintenance', value: data.nextMaintenance ? formatDate(data.nextMaintenance) : '—' },
                { label: 'Interventions', value: String(data.interventions.length) },
                { label: 'Pannes', value: String(data.breakdowns.length) },
                ...(data.maintenanceCost === null ? [] : [{ label: 'Coût de maintenance', value: formatMoney(data.maintenanceCost) }]),
              ]}
              tabs={[
                { key: 'interventions', label: 'Interventions', content: <ModuleList config={interventions} scope={{ equipmentId: id }} readOnly={readOnly} /> },
                { key: 'breakdowns', label: 'Pannes', content: <BreakdownsTab breakdowns={data.breakdowns} /> },
                ...(tasks ? [{ key: 'tasks', label: 'Tâches', content: <ModuleList config={tasks} scope={{ equipmentId: id }} readOnly={readOnly} /> }] : []),
              ]}
            />
            {Dialog && <Dialog row={data} onClose={() => setActing(null)} onDone={() => { setActing(null); refresh(); }} />}
          </>
        );
      }}
    </DetailGate>
  );
}
