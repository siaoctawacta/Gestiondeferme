import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Copy } from 'lucide-react';
import { useAuth, type TwoFactorSetup } from '../lib/auth';
import { Alert } from './ui/Alert';
import { Button } from './ui/Button';
import { Field } from './ui/Field';

export interface TwoFactorEnrollProps {
  /** Called once the user confirmed they saved their backup codes. */
  onFinished: () => Promise<void> | void;
}

/** QR + code confirmation, then the one-time list of backup codes. */
export function TwoFactorEnroll({ onFinished }: TwoFactorEnrollProps) {
  const { setupTwoFactor, enableTwoFactor } = useAuth();
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One setup request per mount: a second call would replace the secret just displayed.
  const request = useRef<Promise<TwoFactorSetup> | null>(null);

  useEffect(() => {
    request.current ??= setupTwoFactor();
    request.current.then(setSetup, (e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const activate = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => setCodes(await enableTwoFactor(code.trim())));
  };

  if (codes) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Conservez ces codes de secours en lieu sûr. Chacun ne peut servir qu&apos;une fois et ils ne seront plus
          affichés.
        </p>
        <ul className="grid grid-cols-2 gap-2">
          {codes.map((c) => (
            <li key={c} className="rounded-xl bg-muted px-3 py-2 text-center font-mono text-sm">
              {c}
            </li>
          ))}
        </ul>
        {error && <Alert>{error}</Alert>}
        <Button className="w-full" disabled={busy} onClick={() => void run(async () => onFinished())}>
          J&apos;ai enregistré mes codes
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={activate} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Scannez ce QR code avec votre application d&apos;authentification (Google Authenticator, Authy…), puis saisissez
        le code à 6 chiffres affiché.
      </p>
      {setup && (
        <div className="flex flex-col items-center gap-3">
          <img src={setup.qrDataUrl} alt="QR code de double authentification" className="size-44 rounded-xl border border-border" />
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Clé :</span>
            <code className="select-all rounded-lg bg-muted px-2 py-1 font-mono">{setup.secret}</code>
            <button
              type="button"
              aria-label="Copier la clé"
              className="flex size-8 items-center justify-center rounded-full hover:bg-muted"
              onClick={() => void navigator.clipboard?.writeText(setup.secret)}
            >
              <Copy aria-hidden className="size-4" />
            </button>
          </div>
        </div>
      )}
      <Field
        label="Code de vérification"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={20}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        required
      />
      {error && <Alert>{error}</Alert>}
      <Button type="submit" className="w-full" disabled={busy || !setup || code.trim().length < 6}>
        Activer
      </Button>
    </form>
  );
}
