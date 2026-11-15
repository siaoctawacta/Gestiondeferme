import type { HTMLAttributes, ReactNode } from 'react';

export function EmptyData({ children = 'Aucune donnée pour le moment' }: { children?: ReactNode }) {
  return <p className="py-10 text-center text-sm text-muted-foreground">{children}</p>;
}

export function Skeleton({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden {...rest} className={`animate-pulse rounded-[calc(var(--radius)+10px)] bg-muted ${className}`} />;
}
