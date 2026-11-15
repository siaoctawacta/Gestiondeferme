import type { ReactNode } from 'react';

const TONES = {
  success: 'bg-primary-soft text-accent-foreground',
  warning: 'bg-warning/35 text-warning-foreground',
  danger: 'bg-destructive/15 text-destructive',
  neutral: 'bg-muted text-muted-foreground',
} as const;

export type PillTone = keyof typeof TONES;

export function Pill({ tone = 'neutral', strong = false, children }: { tone?: PillTone; /** Semibold text (the occupation-rate pill). */ strong?: boolean; children: ReactNode }) {
  return (
    <span
      data-tone={tone}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs ${strong ? 'font-semibold' : 'font-medium'} ${TONES[tone]}`}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}
