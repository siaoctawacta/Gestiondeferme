import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Loader2, ShieldAlert } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import type { ModuleKey } from '../../lib/modules';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { Card } from '../ui/Card';

export function FullScreenLoader() {
  return (
    <div role="status" aria-label="Chargement" className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 aria-hidden className="size-8 animate-spin text-primary" />
    </div>
  );
}

/** A post-login destination is only honoured when it is an in-app path (never `//host`). */
export function safeRedirect(from: unknown): string {
  return typeof from === 'string' && /^\/(?![/\\])/.test(from) ? from : '/';
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, signedOut } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'anonymous') {
    return (
      <Navigate
        to="/login"
        replace
        state={signedOut ? null : { from: location.pathname + location.search }}
      />
    );
  }
  return children;
}

export function MessageCard({ title, children }: { title: string; children: ReactNode }) {
  useDocumentTitle(title);
  return (
    <Card className="mx-auto max-w-md p-8 text-center">
      <ShieldAlert aria-hidden className="mx-auto mb-3 size-8 text-muted-foreground" />
      <h1 className="font-display text-xl font-bold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{children}</p>
    </Card>
  );
}

export function RequirePermission({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(module, 'read')) {
    return <MessageCard title="Accès non autorisé">Votre rôle ne permet pas d&apos;accéder à cette page.</MessageCard>;
  }
  return children;
}
