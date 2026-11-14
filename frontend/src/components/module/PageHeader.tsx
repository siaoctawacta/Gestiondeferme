import type { ReactNode } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

export interface PageHeaderProps {
  /** Small label above the title (module group, greeting…); omitted when absent. */
  group?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** Dashboard-sized title (36 px instead of 30 px). */
  large?: boolean;
}

/** The one page header: small group label, big title, subtitle on the left; actions at the bottom right. Also sets the tab title. */
export function PageHeader({ group, title, subtitle, actions, large = false }: PageHeaderProps) {
  useDocumentTitle(title);
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {group && <p className="text-sm text-muted-foreground">{group}</p>}
        <h1 className={large ? 'text-4xl font-bold leading-10' : 'text-3xl font-bold leading-tight'}>{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 print:hidden [&_button]:h-9!">{actions}</div>}
    </div>
  );
}
