import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { Leaf } from 'lucide-react';
import type { Permissions } from '../../lib/modules';
import { visibleNav } from './nav';

export interface SidebarProps {
  permissions: Permissions;
  alertCount: number;
  /** Slot at the foot of the sidebar (farm switcher). */
  footer?: ReactNode;
  /** Called after a navigation click (closes the mobile drawer). */
  onNavigate?: () => void;
}

export function Sidebar({ permissions, alertCount, footer, onNavigate }: SidebarProps) {
  return (
    <aside className="flex h-full w-full flex-col bg-ink text-ink-foreground">
      <div className="flex items-center gap-3 px-6 pb-[22px] pt-[18px]">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Leaf aria-hidden className="size-4" />
        </span>
        <div className="leading-none">
          <div className="font-display text-lg font-bold leading-[18px]">AgriPilot</div>
          <div className="text-xs leading-[14px] text-ink-muted">Ferme avicole &amp; porcine</div>
        </div>
      </div>

      <nav aria-label="Navigation principale" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {visibleNav(permissions).map((g, gi) => (
          <div key={g.group ?? `g${gi}`} className={g.group ? (gi === 1 ? 'mt-3' : 'mt-3.5') : ''}>
            {g.group && (
              <div className="px-3 pb-[7px] pt-1 text-[11px] font-medium uppercase tracking-wider text-ink-muted">
                {g.group}
              </div>
            )}
            <ul className="space-y-1">
              {g.items.map((item) => (
                <li key={item.slug}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `group flex ${g.group ? 'h-10' : 'h-11'} items-center gap-3 rounded-xl px-3 text-sm transition-colors hover:bg-ink-soft/60 ${
                        isActive ? 'bg-ink-soft font-semibold text-white' : 'text-ink-muted'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          className={`flex size-7 shrink-0 items-center justify-center rounded-full ${
                            isActive ? 'bg-primary text-primary-foreground' : 'bg-ink-soft text-ink-muted'
                          }`}
                        >
                          <item.icon aria-hidden className="size-3.5" />
                        </span>
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.slug === 'alertes' && alertCount > 0 && (
                          <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
                            {alertCount}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {footer && <div className="border-t border-white/10 p-4">{footer}</div>}
    </aside>
  );
}
