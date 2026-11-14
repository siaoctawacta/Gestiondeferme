import type { ReactNode } from 'react';

export interface PageHeaderProps {
  group: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

/** Small group label, big title, subtitle on the left; page actions at the bottom right. */
export function PageHeader({ group, title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-sm text-muted-foreground">{group}</p>
        <h1 className="text-3xl font-bold leading-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 [&_button]:h-9!">{actions}</div>}
    </div>
  );
}
