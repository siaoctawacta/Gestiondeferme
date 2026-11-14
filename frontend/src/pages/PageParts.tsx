import type { ReactNode } from 'react';

export function EmptyData({ children = 'Aucune donnée pour le moment' }: { children?: ReactNode }) {
  return <p className="py-10 text-center text-sm text-muted-foreground">{children}</p>;
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-[calc(var(--radius)+10px)] bg-muted ${className}`} />;
}
