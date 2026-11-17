import { CircleCheck, Image, Play, RotateCcw } from 'lucide-react';
import { useRef } from 'react';
import { ActionDialog } from '../components/module/ActionDialog';
import type { RowAction } from '../components/module/types';
import { api, ApiError } from '../lib/api';
import { todayIso } from '../lib/format';
import { nextDueDate, type TaskRow } from './tachesShared';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_REFUSED = 'Photo invalide : JPEG, PNG ou WebP de 5 Mo au plus';

/**
 * Completion: the date done (default today) and an optional proof photo. The task is completed first (`/complete`), then
 * the photo is sent (`/proof`, multipart). When only the photo fails the task is already completed: the dialog says so,
 * and closing it refreshes the list.
 */
function CompleteDialog({ row, onClose, onDone }: { row: TaskRow; onClose: () => void; onDone: () => void }) {
  const completed = useRef(false);
  const next = nextDueDate(row.dueDate, row.recurrence);
  return (
    <ActionDialog
      title={`Terminer — ${row.title}`}
      fields={[
        {
          name: 'date', label: 'Date de réalisation', type: 'date', required: true, defaultValue: todayIso,
          hint: next ? `La prochaine occurrence sera créée pour le ${next}` : undefined,
        },
        { name: 'photo', label: 'Photo (preuve)', type: 'file', accept: 'image/jpeg,image/png,image/webp' },
      ]}
      validate={(v) => (v.photo instanceof File && v.photo.size > MAX_PHOTO_BYTES ? PHOTO_REFUSED : null)}
      onSubmit={async (body) => {
        const { date, photo } = body as { date: string; photo?: File };
        if (!completed.current) await api.post(`/tasks/${row.id}/complete`, { date });
        completed.current = true;
        if (photo) {
          const form = new FormData();
          form.append('file', photo);
          try {
            await api.post(`/tasks/${row.id}/proof`, form);
          } catch (e) {
            throw e instanceof ApiError ? new ApiError(e.status, `La tâche est terminée, mais la photo n'a pas été enregistrée : ${e.message}`) : e;
          }
        }
      }}
      onClose={() => (completed.current ? onDone() : onClose())}
      onDone={onDone}
    />
  );
}

/** Opens the proof photo in a new tab: fetched with the session (the route needs it), shown from an object URL. */
async function showProof(row: TaskRow): Promise<void> {
  const url = URL.createObjectURL(await api.blob(`/tasks/${row.id}/proof`));
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * The progress of a task (`À faire → En cours → Terminée`, and back): offered to whoever may create tasks, or to the
 * assignee (`row.mine`) holding `update`; the proof is read by whoever reads the tasks.
 */
const mineOrManager = (row: TaskRow, { can }: { can: (module: 'taches', action: 'create') => boolean }) => can('taches', 'create') || row.mine;

export const TASK_ACTIONS: RowAction<TaskRow>[] = [
  {
    key: 'start', label: 'Démarrer', icon: Play, permission: 'update',
    visible: (t, ctx) => t.status === 'A_FAIRE' && mineOrManager(t, ctx),
    run: async (t, { refresh }) => { await api.post(`/tasks/${t.id}/start`); refresh(); },
  },
  {
    key: 'complete', label: 'Terminer', icon: CircleCheck, permission: 'update',
    visible: (t, ctx) => t.status !== 'TERMINEE' && mineOrManager(t, ctx),
    dialog: CompleteDialog,
  },
  {
    key: 'reopen', label: 'Rouvrir', icon: RotateCcw, permission: 'update',
    visible: (t, ctx) => t.status === 'TERMINEE' && mineOrManager(t, ctx),
    run: async (t, { refresh }) => { await api.post(`/tasks/${t.id}/reopen`); refresh(); },
  },
  {
    key: 'proof', label: 'Voir la preuve', icon: Image, permission: 'read',
    visible: (t) => t.hasProof,
    run: (t) => showProof(t),
  },
];
