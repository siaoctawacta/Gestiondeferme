import { CircleCheck, Image, ImagePlus, ImageOff, Play, RotateCcw } from 'lucide-react';
import { useRef } from 'react';
import { ActionDialog } from '../components/module/ActionDialog';
import { ConfirmDialog } from '../components/module/ConfirmDialog';
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
  const next = nextDueDate(row.dueDate, row.recurrence, row.recurrenceDay);
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

/** Replaces the proof photo of a task that has one (the old file goes server side). */
function ReplaceProofDialog({ row, onClose, onDone }: { row: TaskRow; onClose: () => void; onDone: () => void }) {
  return (
    <ActionDialog
      title={`Remplacer la photo — ${row.title}`}
      fields={[{ name: 'photo', label: 'Photo (preuve)', type: 'file', accept: 'image/jpeg,image/png,image/webp', required: true }]}
      validate={(v) => (v.photo instanceof File && v.photo.size > MAX_PHOTO_BYTES ? PHOTO_REFUSED : null)}
      onSubmit={async (body) => {
        const form = new FormData();
        form.append('file', (body as { photo: File }).photo);
        await api.post(`/tasks/${row.id}/proof`, form);
      }}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

/** Removes the proof photo after a confirmation (`DELETE /tasks/:id/proof`: the same rights as the upload). */
function RemoveProofDialog({ row, onClose, onDone }: { row: TaskRow; onClose: () => void; onDone: () => void }) {
  return (
    <ConfirmDialog
      title="Supprimer la preuve"
      message={`Supprimer la photo de preuve de « ${row.title} » ? Cette action est irréversible.`}
      onClose={onClose}
      onConfirm={async () => {
        await api.del(`/tasks/${row.id}/proof`);
        onDone();
      }}
    />
  );
}

/**
 * Opens the proof photo in a new tab. The window is opened at once (a browser only allows it in the click, not after the
 * fetch), then pointed at an object URL of the photo fetched with the session (the route needs it).
 */
async function showProof(row: TaskRow): Promise<void> {
  const win = window.open('', '_blank');
  if (!win) throw new ApiError(0, "Le navigateur a bloqué l'ouverture de la photo");
  try {
    const url = URL.createObjectURL(await api.blob(`/tasks/${row.id}/proof`));
    win.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    win.close();
    throw e;
  }
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
  {
    key: 'proofReplace', label: 'Remplacer la photo', icon: ImagePlus, permission: 'update',
    visible: (t, ctx) => t.hasProof && mineOrManager(t, ctx),
    dialog: ReplaceProofDialog,
  },
  {
    key: 'proofRemove', label: 'Supprimer la preuve', icon: ImageOff, permission: 'update',
    visible: (t, ctx) => t.hasProof && mineOrManager(t, ctx),
    dialog: RemoveProofDialog,
  },
];
