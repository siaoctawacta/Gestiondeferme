import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../lib/api';
import { checkNewPassword } from '../lib/password';
import { AuthCard } from '../components/AuthCard';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';

export default function ResetPassword() {
  const { token = '' } = useParams();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const invalid = checkNewPassword(password, confirm);
    if (invalid) return setError(invalid);
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/reset-password', { token, newPassword: password });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <AuthCard title="Mot de passe modifié">
        <Alert tone="success">Votre mot de passe a été réinitialisé.</Alert>
        <Link
          to="/login"
          className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Aller à la connexion
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Nouveau mot de passe">
      <form onSubmit={submit} className="space-y-4">
        <Field
          label="Nouveau mot de passe"
          type="password"
          autoComplete="new-password"
          hint="10 caractères minimum."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <Field
          label="Confirmer le mot de passe"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
        {error && <Alert>{error}</Alert>}
        <Button type="submit" className="w-full" disabled={busy}>
          Réinitialiser
        </Button>
      </form>
    </AuthCard>
  );
}
