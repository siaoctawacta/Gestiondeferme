import type { HTMLAttributes } from 'react';

const TONES = {
  error: 'bg-destructive/10 text-destructive border-destructive/30',
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
