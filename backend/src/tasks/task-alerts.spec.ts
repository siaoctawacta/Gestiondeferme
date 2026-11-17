import type { RequestContext } from '../access/decorators';
import { parseDay } from '../common/days';
import {
  taskAlertRules,
  taskAlerts,
  type OverdueTask,
  type TaskAlertData,
} from './task-alerts';

const NOW = new Date(Date.UTC(2026, 10, 14, 9, 0));
const day = (value: string): Date => parseDay(value) as Date;
const TODAY = day('2026-11-14');
const row = (
  over: Partial<Omit<OverdueTask, 'dueDate'>> & { dueDate?: string } = {},
): OverdueTask => ({
  id: 't1',
  title: 'Pesée hebdomadaire LC-2026-14',
  status: 'A_FAIRE',
  assigneeName: 'Kodjo A.',
  ...over,
  dueDate: day(over.dueDate ?? '2026-10-23'),
});

describe('taskAlerts', () => {
  it('raises Tâche en retard (A_VOIR, taches), oldest due date first, with the assignee', () => {
    const alerts = taskAlerts(
      [
        row({
          id: 'b',
          dueDate: '2026-10-24',
          title: 'Vaccination Gumboro LC-2026-15',
          assigneeName: 'Dr Koffi',
        }),
        row({ id: 'a' }),
        row({
          id: 'c',
          dueDate: '2026-10-18',
          title: 'Nettoyage Porcherie 2',
          assigneeName: 'Yawa M.',
          status: 'EN_COURS',
        }),
        row({ id: 'd', status: 'TERMINEE' }),
      ],
      TODAY,
    );
    expect(alerts).toEqual([
      {
        key: 'task:c:2026-10-18',
        title: 'Tâche en retard',
        detail: 'Nettoyage Porcherie 2 (Yawa M.)',
        level: 'A_VOIR',
        module: 'taches',
        modules: ['taches'],
      },
      {
        key: 'task:a:2026-10-23',
        title: 'Tâche en retard',
        detail: 'Pesée hebdomadaire LC-2026-14 (Kodjo A.)',
        level: 'A_VOIR',
        module: 'taches',
        modules: ['taches'],
      },
      {
        key: 'task:b:2026-10-24',
        title: 'Tâche en retard',
        detail: 'Vaccination Gumboro LC-2026-15 (Dr Koffi)',
        level: 'A_VOIR',
        module: 'taches',
        modules: ['taches'],
      },
    ]);
  });

  it('names only the task without an assignee, and the farm when the request spans several', () => {
    const [bare] = taskAlerts([row({ assigneeName: null })], TODAY);
    expect(bare.detail).toBe('Pesée hebdomadaire LC-2026-14');
    const [farm] = taskAlerts([row({ farmName: 'Ferme B' })], TODAY);
    expect(farm.detail).toBe(
      'Pesée hebdomadaire LC-2026-14 (Kodjo A.) — Ferme B',
    );
  });

  it('raises nothing for a task due today or later', () => {
    expect(taskAlerts([row({ dueDate: '2026-11-14' })], TODAY)).toEqual([]);
    expect(taskAlerts([row({ dueDate: '2026-11-15' })], TODAY)).toEqual([]);
  });

  it('breaks ties by title then id', () => {
    const keys = taskAlerts(
      [
        row({ id: 'z', title: 'B' }),
        row({ id: 'y', title: 'A' }),
        row({ id: 'x', title: 'A' }),
      ],
      TODAY,
    ).map((a) => a.key);
    expect(keys).toEqual([
      'task:x:2026-10-23',
      'task:y:2026-10-23',
      'task:z:2026-10-23',
    ]);
  });
});

describe('task alert key', () => {
  it('carries the due date: a task pushed to a new date is a new alert', () => {
    const [before] = taskAlerts([row({ dueDate: '2026-10-23' })], TODAY);
    const [after] = taskAlerts([row({ dueDate: '2026-11-02' })], TODAY);
    expect(before.key).not.toBe(after.key);
  });
});

describe('taskAlertRules', () => {
  const ctx = (role: string) =>
    ({ user: { role } }) as unknown as RequestContext;
  const data = (rows: OverdueTask[]) => {
    const calls: Date[] = [];
    const source: TaskAlertData = {
      overdue: (_ctx, day) => {
        calls.push(day);
        return Promise.resolve(rows);
      },
    };
    return { source, calls };
  };

  it('reads the tasks due before today (the clock day), once, for a reader of taches', async () => {
    const { source, calls } = data([row()]);
    const [rule] = taskAlertRules(source, () => NOW);
    const items = await rule(ctx('RESP_AVICOLE'), {});
    expect(items).toHaveLength(1);
    expect(calls).toEqual([parseDay('2026-11-14')]);
  });

  it('does not read anything for a role that cannot read taches', async () => {
    const { source, calls } = data([row()]);
    const [rule] = taskAlertRules(source, () => NOW);
    expect(await rule(ctx('COMMERCIAL'), {})).toEqual([]);
    expect(calls).toEqual([]);
  });
});
