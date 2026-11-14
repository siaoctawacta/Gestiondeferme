import type { HTMLAttributes } from 'react';

const TONES = {
  // Text is a darker red than --destructive: 6:1 on the tinted background (4.0:1 with --destructive itself).
  error: 'bg-destructive/10 text-[oklch(48%_0.2_25)] border-destructive/30',
  success: 'bg-primary-soft text-accent-foreground border-primary/30',
} as const;

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  tone?: keyof typeof TONES;
}

export function Alert({ tone = 'error', className = '', ...props }: AlertProps) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`whitespace-pre-line rounded-2xl border px-4 py-3 text-sm ${TONES[tone]} ${className}`}
      {...props}
    />
  );
}
