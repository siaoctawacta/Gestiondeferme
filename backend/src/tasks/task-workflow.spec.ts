import { formatDay, parseDay } from '../common/days';
import {
  TASK_ACTIONS,
  TASK_STATUS_LIST,
  can,
  isOverdue,
  isUntouched,
  nextDueDate,
  refusal,
  statusAfter,
  type TaskAction,
  type TaskStatusValue,
} from './task-workflow';

const ALLOWED: Record<TaskAction, TaskStatusValue[]> = {
  edit: ['A_FAIRE', 'EN_COURS'],
  delete: ['A_FAIRE', 'EN_COURS'],
  start: ['A_FAIRE'],
  complete: ['A_FAIRE', 'EN_COURS'],
  reopen: ['TERMINEE'],
  proof: ['A_FAIRE', 'EN_COURS', 'TERMINEE'],
};

const day = (value: string): Date => parseDay(value) as Date;

describe('task workflow', () => {
  it('lists the six actions', () => {
    expect([...TASK_ACTIONS]).toEqual([
      'edit',
      'delete',
      'start',
      'complete',
      'reopen',
      'proof',
    ]);
  });

  describe.each(TASK_ACTIONS)('%s', (action) => {
    it.each(TASK_STATUS_LIST)('from %s', (status) => {
      expect(can(status, action)).toBe(ALLOWED[action].includes(status));
    });
  });

  it('refuses with the exact message, and only when the action is not allowed', () => {
    expect(refusal('TERMINEE', 'edit')).toBe(
      'Une tâche terminée ne peut plus être modifiée : rouvrez-la',
    );
    expect(refusal('TERMINEE', 'delete')).toBe(
      'Une tâche terminée ne peut pas être supprimée',
    );
    expect(refusal('EN_COURS', 'start')).toBe(
      'Seule une tâche à faire peut être démarrée',
    );
    expect(refusal('TERMINEE', 'start')).toBe(
      'Seule une tâche à faire peut être démarrée',
    );
    expect(refusal('TERMINEE', 'complete')).toBe(
      'Cette tâche est déjà terminée',
    );
    expect(refusal('A_FAIRE', 'reopen')).toBe(
      'Seule une tâche terminée peut être rouverte',
    );
    expect(refusal('EN_COURS', 'reopen')).toBe(
      'Seule une tâche terminée peut être rouverte',
    );
    for (const action of TASK_ACTIONS) {
      for (const status of TASK_STATUS_LIST) {
        expect(refusal(status, action) === null).toBe(can(status, action));
      }
    }
  });

  it('takes back an occurrence only while nobody has started it', () => {
    expect(isUntouched('A_FAIRE')).toBe(true);
    expect(isUntouched('EN_COURS')).toBe(false);
    expect(isUntouched('TERMINEE')).toBe(false);
  });

  it('says the status each action leads to', () => {
    expect(statusAfter('start')).toBe('EN_COURS');
    expect(statusAfter('complete')).toBe('TERMINEE');
    expect(statusAfter('reopen')).toBe('A_FAIRE');
    expect(statusAfter('edit')).toBeNull();
    expect(statusAfter('delete')).toBeNull();
    expect(statusAfter('proof')).toBeNull();
  });

  it('is overdue when open and due before today, never on the day itself', () => {
    const today = day('2026-11-14');
    const due = (status: TaskStatusValue, d: string) =>
      isOverdue({ status, dueDate: day(d) }, today);
    expect(due('A_FAIRE', '2026-11-13')).toBe(true);
    expect(due('EN_COURS', '2026-10-01')).toBe(true);
    expect(due('A_FAIRE', '2026-11-14')).toBe(false);
    expect(due('A_FAIRE', '2026-11-15')).toBe(false);
    expect(due('TERMINEE', '2026-10-01')).toBe(false);
  });

  describe('nextDueDate', () => {
    const next = (d: string, r: Parameters<typeof nextDueDate>[1]) => {
      const out = nextDueDate(day(d), r);
      return out && formatDay(out);
    };
    it('adds a day, a week, or a month clamped to its last day', () => {
      expect(next('2026-10-23', 'HEBDOMADAIRE')).toBe('2026-10-30');
      expect(next('2026-01-31', 'MENSUELLE')).toBe('2026-02-28');
      expect(next('2026-12-31', 'QUOTIDIENNE')).toBe('2027-01-01');
      expect(next('2026-12-15', 'MENSUELLE')).toBe('2027-01-15');
      expect(next('2028-01-31', 'MENSUELLE')).toBe('2028-02-29');
      expect(next('2026-10-31', 'MENSUELLE')).toBe('2026-11-30');
    });
    it('has none for a one-off task', () => {
      expect(next('2026-10-23', 'AUCUNE')).toBeNull();
    });
  });
});
