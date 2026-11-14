import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { ApiError } from '../lib/api';
import { SessionStartError, useAuth } from '../lib/auth';
import { formatDateTimeFr } from '../lib/format';
import { AuthCard } from '../components/AuthCard';
import { FullScreenLoader, safeRedirect } from '../components/shell/guards';
import { TwoFactorEnroll } from '../components/TwoFactorEnroll';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';

type Step = 'credentials' | 'twoFactor' | 'setup';

function loginMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 423) {
      const until = e.body?.lockedUntil;
      return typeof until === 'string'
        ? `Compte verrouillé après trop de tentatives. Réessayez à partir du ${formatDateTimeFr(until)}.`
        : e.message;
    }
    if (e.status === 429) return 'Trop de tentatives. Patientez un instant avant de réessayer.';
    return e.message;
  }
  if (e instanceof SessionStartError) return e.message;
  return 'Impossible de joindre le serveur. Réessayez.';
}

export default function Login() {
  const { status, login, verify2fa, completeSetup } = useAuth();
  const location = useLocation();
  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'authenticated') {
    const from = (location.state as { from?: unknown } | null)?.from;
    return <Navigate to={safeRedirect(from)} replace />;
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      // The session could not be loaded: start over from the credentials.
      if (e instanceof SessionStartError) setStep('credentials');
      setError(loginMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submitCredentials = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const result = await login(email.trim(), password);
      if (result.kind === 'twoFactor') setStep('twoFactor');
      if (result.kind === 'setup') setStep('setup');
    });
  };

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    void run(() => verify2fa(code.trim()));
  };

  if (step === 'setup') {
    return (
      <AuthCard title="Activer la double authentification">
        <p className="mb-4 text-sm text-muted-foreground">
          Votre rôle exige la double authentification. Activez-la pour accéder à AgriPilot.
        </p>
        <TwoFactorEnroll onFinished={() => run(completeSetup)} />
      </AuthCard>
    );
  }

  if (step === 'twoFactor') {
    return (
      <AuthCard title="Vérification en deux étapes">
        <form onSubmit={submitCode} className="space-y-4">
          <Field
            label="Code de vérification"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={20}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            hint="Saisissez le code à 6 chiffres de votre application. Un code de secours fonctionne aussi."
            required
          />
          {error && <Alert>{error}</Alert>}
          <Button type="submit" className="w-full" disabled={busy || code.trim().length < 6}>
            Vérifier
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              setStep('credentials');
              setCode('');
              setError(null);
            }}
          >
            Retour
          </Button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Connexion">
      <form onSubmit={submitCredentials} className="space-y-4">
        <Field
          label="Adresse e-mail"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Field
          label="Mot de passe"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <Alert>{error}</Alert>}
        <Button type="submit" className="w-full" disabled={busy}>
          Se connecter
        </Button>
      </form>
    </AuthCard>
  );
}
