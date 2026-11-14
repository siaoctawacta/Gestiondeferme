import type { ButtonHTMLAttributes } from 'react';

const VARIANTS = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  dark: 'bg-ink text-ink-foreground hover:bg-ink-soft',
  outline: 'bg-card text-foreground border border-border shadow-card hover:bg-muted',
  ghost: 'bg-transparent text-foreground hover:bg-muted',
} as const;

const SIZES = {
  md: 'h-10 px-4 text-sm gap-2',
  sm: 'h-8 px-3 text-xs gap-1.5',
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
}

export function Button({
  variant = 'primary', size = 'md', className = '', type = 'button', ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center rounded-full font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    />
  );
}
