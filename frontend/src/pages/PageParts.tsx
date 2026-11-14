import type { ReactNode } from 'react';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';

/** Title block of the dashboard-family pages: big title, muted subtitle, actions at the right. */
export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold leading-9">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 print:hidden [&_button]:h-9">{actions}</div>}
    </div>
  );
}

export function ErrorRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Alert className="flex-1">{message}</Alert>
      <Button variant="outline" onClick={onRetry}>Réessayer</Button>
    </div>
  );
}

export function EmptyData({ children = 'Aucune donnée pour le moment' }: { children?: ReactNode }) {
  return <p className="py-10 text-center text-sm text-muted-foreground">{children}</p>;
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-[calc(var(--radius)+10px)] bg-muted ${className}`} />;
}
