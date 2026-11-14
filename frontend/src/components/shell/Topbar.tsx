import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Bell, Menu } from 'lucide-react';
import { SearchInput } from '../ui/Input';
import type { Permissions } from '../../lib/modules';
import { visibleNav } from './nav';

export interface TopbarProps {
  permissions: Permissions;
  alertCount: number;
  onMenu: () => void;
}

export function Topbar({ permissions, alertCount, onMenu }: TopbarProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return visibleNav(permissions)
      .flatMap((g) => g.items)
      .filter((i) => i.label.toLowerCase().includes(q));
  }, [query, permissions]);

  const go = (to: string) => {
    navigate(to);
    setQuery('');
  };

  return (
    <header className="sticky top-0 z-30 flex h-[65px] items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur md:px-8">
      <button
        type="button"
        aria-label="Ouvrir le menu"
        onClick={onMenu}
        className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-card lg:hidden"
      >
        <Menu className="size-5" />
      </button>

      <div className="relative w-full max-w-md">
        <SearchInput
          className="[&>input]:h-[38px]"
          aria-label="Rechercher un module"
          placeholder="Rechercher un module…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches[0]) go(matches[0].to);
            if (e.key === 'Escape') setQuery('');
          }}
        />
        {matches.length > 0 && (
          <ul className="absolute left-0 right-0 top-12 z-40 overflow-hidden rounded-2xl border border-border bg-card py-1 shadow-card">
            {matches.map((i) => (
              <li key={i.slug}>
                <button
                  type="button"
                  onClick={() => go(i.to)}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-muted"
                >
                  <i.icon aria-hidden className="size-4 text-muted-foreground" />
                  {i.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Link
        to="/alertes"
        aria-label="Alertes"
        className="relative flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-card"
      >
        <Bell className="size-4" />
        {alertCount > 0 && (
          <span aria-hidden className="absolute right-[9px] top-[9px] size-2 rounded-full bg-destructive" />
        )}
      </Link>
    </header>
  );
}
