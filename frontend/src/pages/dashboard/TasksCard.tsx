import { Link } from 'react-router';
import { Card } from '../../components/ui/Card';
import { Pill, type PillTone } from '../../components/ui/Pill';
import { EmptyData } from '../PageParts';
import type { DashboardDto, Priority } from '../../lib/dashboard';

const PRIORITY: Record<Priority, { label: string; tone: PillTone }> = {
  NORMALE: { label: 'Normale', tone: 'success' },
  HAUTE: { label: 'Haute', tone: 'warning' },
  URGENTE: { label: 'Urgente', tone: 'danger' },
};

export function TasksCard({ tasks }: { tasks: DashboardDto['upcomingTasks'] }) {
  return (
    <Card className="overflow-hidden pt-5">
      <div className="flex items-center justify-between px-5 pb-5">
        <h2 className="text-lg font-bold">Tâches à venir</h2>
        <Link to="/m/taches" className="text-sm font-medium text-primary hover:underline">Gérer</Link>
      </div>
      {tasks.length === 0 ? (
        <div className="border-t border-border"><EmptyData /></div>
      ) : (
        <div className="overflow-x-auto"><table className="w-full min-w-[560px] table-fixed border-collapse text-sm">
          <colgroup>
            <col style={{ width: '44.8%' }} /><col style={{ width: '15.6%' }} />
            <col style={{ width: '19.5%' }} /><col />
          </colgroup>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id} className="border-t border-border">
                <td className="truncate px-5 py-3 font-medium">{t.title}</td>
                <td className="truncate px-5 py-3 text-muted-foreground">{t.assignee}</td>
                <td className="px-5 py-3">{t.dueDate.slice(0, 10)}</td>
                <td className="px-5 py-3"><Pill tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Pill></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </Card>
  );
}
