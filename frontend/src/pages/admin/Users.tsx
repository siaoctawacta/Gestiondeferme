import { useMemo, useState } from 'react';
import { KeyRound, ShieldOff } from 'lucide-react';
import { ConfirmDialog } from '../../components/module/ConfirmDialog';
import { errorMessage } from '../../components/module/errorMessage';
import { ModulePage } from '../../components/module/ModulePage';
import type { FormMap, FormMode, ModuleConfig } from '../../components/module/types';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Input } from '../../components/ui/Input';
import { Pill } from '../../components/ui/Pill';
import { ApiError, api } from '../../lib/api';
import { formatDateTimeFr } from '../../lib/format';
import { ROLE_LABELS, ROLE_OPTIONS } from '../../lib/roles';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  farms: { id: string; name: string }[];
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
}

type LinkState =
  | { status: 'loading' }
  | { status: 'ready'; url: string; expiresAt: string }
  | { status: 'error'; message: string };

function ResetLinkDialog({ state, onClose }: { state: LinkState; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title="Lien de réinitialisation">
      {state.status === 'loading' && <p className="text-sm text-muted-foreground">Génération du lien…</p>}
      {state.status === 'error' && <Alert>{state.message}</Alert>}
      {state.status === 'ready' && (
        <div className="space-y-3">
          <p className="text-sm">Transmettez ce lien à l’utilisateur pour qu’il choisisse un nouveau mot de passe.</p>
          <div className="flex gap-2">
            <Input readOnly aria-label="Lien de réinitialisation" value={state.url} onFocus={(e) => e.target.select()} />
            <Button onClick={() => copy(state.url)}>{copied ? 'Copié' : 'Copier'}</Button>
          </div>
          <p className="text-xs text-muted-foreground">Valable jusqu’au {formatDateTimeFr(state.expiresAt)}</p>
        </div>
      )}
      <div className="mt-6 flex justify-end">
        <Button variant="outline" onClick={onClose}>Fermer</Button>
      </div>
    </Dialog>
  );
}

// Roles that work across farms: every other role needs at least one assigned farm, or it sees nothing.
const FARMLESS_ROLES = ['SUPER_ADMIN', 'PROPRIETAIRE', 'AUDITEUR'];

function toPayload(values: FormMap, mode: FormMode): unknown {
  const role = String(values.role);
  const farmIds = values.farmIds as string[];
  if (!FARMLESS_ROLES.includes(role) && farmIds.length === 0) {
    // The form dialog shows the message of an ApiError.
    throw new ApiError(400, `Le champ « Fermes » est requis : sélectionnez au moins une ferme pour le rôle « ${ROLE_LABELS[role] ?? role} »`);
  }
  const common = { name: String(values.name).trim(), role, farmIds };
  return mode === 'create'
    ? { ...common, email: String(values.email).trim(), password: values.password }
    : { ...common, active: values.active };
}

export const users: ModuleConfig<User> = {
  slug: 'utilisateurs',
  group: 'Administration',
  title: 'Utilisateurs',
  subtitle: 'Comptes, rôles et accès aux fermes.',
  endpoint: '/users',
  farmScoped: false,
  columns: [
    { key: 'name', header: 'Nom', sortable: true },
    { key: 'email', header: 'Email', sortable: true },
    { key: 'role', header: 'Rôle', sortable: true, render: (u) => ROLE_LABELS[u.role] ?? u.role },
    { key: 'farms', header: 'Fermes', render: (u) => u.farms.map((f) => f.name).join(', ') || '—' },
    {
      key: 'twoFactorEnabled',
      header: '2FA',
      render: (u) => <Pill tone={u.twoFactorEnabled ? 'success' : 'neutral'}>{u.twoFactorEnabled ? 'Activée' : 'Non activée'}</Pill>,
    },
    {
      key: 'active',
      header: 'Statut',
      sortable: true,
      render: (u) => <Pill tone={u.active ? 'success' : 'neutral'}>{u.active ? 'Actif' : 'Inactif'}</Pill>,
    },
  ],
  fields: [
    { name: 'name', label: 'Nom', type: 'text', required: true },
    { name: 'email', label: 'E-mail', type: 'text', required: true, only: 'create' },
    { name: 'role', label: 'Rôle', type: 'select', required: true, options: ROLE_OPTIONS },
    { name: 'farmIds', label: 'Fermes', type: 'multiselect', options: { endpoint: '/farms' } },
    { name: 'password', label: 'Mot de passe', type: 'password', required: true, minLength: 10, only: 'create' },
    { name: 'active', label: 'Compte actif', type: 'checkbox', only: 'update' },
  ],
  toPayload,
  toForm: (u) => ({ name: u.name, role: u.role, active: u.active, farmIds: u.farms.map((f) => f.id) }),
  rowLabel: (u) => u.name,
};

type ConfirmState = { user: User; refresh: () => void };

export default function Users() {
  const [link, setLink] = useState<LinkState | null>(null);
  const [confirm2fa, setConfirm2fa] = useState<ConfirmState | null>(null);

  const config = useMemo<ModuleConfig<User>>(
    () => ({
      ...users,
      actions: [
        {
          key: 'reset-link',
          label: 'Lien de réinitialisation',
          icon: KeyRound,
          run: async (user) => {
            setLink({ status: 'loading' });
            try {
              const res = await api.post<{ url: string; expiresAt: string }>(`/users/${user.id}/reset-link`);
              setLink({ status: 'ready', ...res });
            } catch (e) {
              setLink({ status: 'error', message: errorMessage(e) });
            }
          },
        },
        {
          key: 'reset-2fa',
          label: 'Réinitialiser 2FA',
          icon: ShieldOff,
          run: (user, { refresh }) => setConfirm2fa({ user, refresh }),
        },
      ],
    }),
    [],
  );

  return (
    <>
      <ModulePage config={config} />
      {link && <ResetLinkDialog state={link} onClose={() => setLink(null)} />}
      {confirm2fa && (
        <ConfirmDialog
          title="Réinitialiser la 2FA"
          message={`Réinitialiser la double authentification de « ${confirm2fa.user.name} » ? Il devra la configurer à nouveau.`}
          confirmLabel="Réinitialiser"
          onClose={() => setConfirm2fa(null)}
          onConfirm={async () => {
            await api.post(`/users/${confirm2fa.user.id}/reset-2fa`);
            confirm2fa.refresh();
            setConfirm2fa(null);
          }}
        />
      )}
    </>
  );
}
