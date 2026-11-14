import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { checkNewPassword } from '../lib/password';
import { TwoFactorEnroll } from '../components/TwoFactorEnroll';
import { errorMessage } from '../components/module/errorMessage';
import { PageHeader } from '../components/module/PageHeader';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Field } from '../components/ui/Field';

// Roles for which the server refuses to turn 2FA off.
const MANDATORY_2FA_ROLES = ['SUPER_ADMIN', 'PROPRIETAIRE', 'DIRECTEUR_FERME', 'COMPTABLE'];

function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    const invalid = checkNewPassword(next, confirm);
    if (invalid) return setError(invalid);
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      setSaved(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-6">
      <h2 className="mb-4 font-display text-lg font-bold">Mot de passe</h2>
      <form onSubmit={submit} className="max-w-md space-y-4">
        <Field label="Mot de passe actuel" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        <Field label="Nouveau mot de passe" type="password" autoComplete="new-password" hint="10 caractères minimum." value={next} onChange={(e) => setNext(e.target.value)} required />
        <Field label="Confirmer le nouveau mot de passe" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        {error && <Alert>{error}</Alert>}
        {saved && <Alert tone="success">Mot de passe modifié.</Alert>}
        <Button type="submit" disabled={busy}>Modifier le mot de passe</Button>
      </form>
    </Card>
  );
}

function TwoFactorCard() {
  const { user, reload } = useAuth();
  const [enrolling, setEnrolling] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  const mandatory = MANDATORY_2FA_ROLES.includes(user.role);

  const disable = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/2fa/disable', { password, code: code.trim() });
      setPassword('');
      setCode('');
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-6">
      <h2 className="mb-1 font-display text-lg font-bold">Double authentification</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        État :{' '}
        <strong className={user.twoFactorEnabled || enrolling ? 'text-primary' : 'text-foreground'}>
          {user.twoFactorEnabled || enrolling ? 'activée' : 'désactivée'}
        </strong>
      </p>

      {enrolling ? (
        <div className="max-w-md">
          <TwoFactorEnroll onFinished={() => setEnrolling(false)} />
        </div>
      ) : !user.twoFactorEnabled ? (
        <Button onClick={() => setEnrolling(true)}>Activer la double authentification</Button>
      ) : mandatory ? (
        <p className="text-sm text-muted-foreground">
          La double authentification est obligatoire pour votre rôle : elle ne peut pas être désactivée.
        </p>
      ) : (
        <form onSubmit={disable} className="max-w-md space-y-4">
          <p className="text-sm text-muted-foreground">
            Pour la désactiver, confirmez votre mot de passe et un code de vérification (ou de secours).
          </p>
          <Field label="Mot de passe" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <Field label="Code de vérification" inputMode="numeric" autoComplete="one-time-code" maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} required />
          {error && <Alert>{error}</Alert>}
          <Button type="submit" variant="outline" disabled={busy}>Désactiver</Button>
        </form>
      )}
    </Card>
  );
}

export default function Account() {
  const { user } = useAuth();
  return (
    <div className="space-y-6">
      <PageHeader large title="Mon compte" subtitle={user ? `${user.name} · ${user.email}` : undefined} />
      <div className="grid gap-6 xl:grid-cols-2">
        <PasswordCard />
        <TwoFactorCard />
      </div>
    </div>
  );
}
