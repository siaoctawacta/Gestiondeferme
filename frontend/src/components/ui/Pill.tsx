import type { ReactNode } from 'react';

const TONES = {
  success: 'bg-primary-soft text-accent-foreground',
  warning: 'bg-warning/35 text-warning-foreground',
  danger: 'bg-destructive/15 text-destructive',
  neutral: 'bg-muted text-muted-foreground',
} as const;

export type PillTone = keyof typeof TONES;

export function Pill({ tone = 'neutral', children }: { tone?: PillTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}
