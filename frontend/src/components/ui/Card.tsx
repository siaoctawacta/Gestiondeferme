import type { HTMLAttributes } from 'react';

export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-[calc(var(--radius)+10px)] bg-card text-card-foreground shadow-card ${className}`}
      {...props}
    />
  );
}
