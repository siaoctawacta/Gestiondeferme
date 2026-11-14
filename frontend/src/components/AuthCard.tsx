import type { ReactNode } from 'react';
import { Leaf } from 'lucide-react';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { Card } from './ui/Card';

/** Centred card on the page background, used by the public auth pages. */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  useDocumentTitle(title);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Leaf aria-hidden className="size-5" />
        </span>
        <div className="leading-none">
          <div className="font-display text-xl font-bold leading-6">AgriPilot</div>
          <div className="text-xs leading-4 text-muted-foreground">Ferme avicole &amp; porcine</div>
        </div>
      </div>
      <Card className="w-full max-w-md p-6 sm:p-8">
        <h1 className="mb-6 font-display text-2xl font-bold">{title}</h1>
        {children}
      </Card>
    </div>
  );
}
