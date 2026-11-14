import type { LucideIcon } from 'lucide-react';

export interface KpiCardProps {
  label: string;
  value: string;
  sub: string;
  icon: LucideIcon;
  /** The ink-black emphasised card (first of the row). */
  dark?: boolean;
}

export function KpiCard({ label, value, sub, icon: Icon, dark = false }: KpiCardProps) {
  return (
    <div
      className={`rounded-[calc(var(--radius)+10px)] p-5 shadow-card ${
        dark ? 'bg-ink text-ink-foreground' : 'bg-card text-card-foreground'
      }`}
    >
      <div className="flex items-center justify-between">
        <p className={`text-sm ${dark ? 'text-ink-muted' : 'text-muted-foreground'}`}>{label}</p>
        <span
          className={`flex size-9 items-center justify-center rounded-full ${
            dark ? 'bg-primary text-primary-foreground' : 'bg-primary-soft text-accent-foreground'
          }`}
        >
          <Icon aria-hidden className="size-4" />
        </span>
      </div>
      <p className="mt-3 font-display text-[30px] font-bold leading-9 tracking-tight">{value}</p>
      <p className={`mt-1 text-xs ${dark ? 'text-ink-muted' : 'text-muted-foreground'}`}>{sub}</p>
    </div>
  );
}
