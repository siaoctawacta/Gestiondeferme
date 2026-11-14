import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Check, ChevronsUpDown, LogOut, UserRound } from 'lucide-react';
import { ALL_FARMS, useAuth } from '../../lib/auth';

const ALL_LABEL = 'Toutes les fermes';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

/** Sidebar foot: who is signed in, the active farm, and the farm / account / logout menu. */
export function FarmSwitcher() {
  const { user, farms, farmId, setFarmId, canSeeAllFarms, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  const activeLabel =
    farmId === ALL_FARMS ? ALL_LABEL : (farms.find((f) => f.id === farmId)?.name ?? 'Aucune ferme');
  const options = [
    ...(canSeeAllFarms ? [{ id: ALL_FARMS, name: ALL_LABEL }] : []),
    ...farms,
  ];
  const item =
    'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-foreground hover:bg-muted';

  return (
    <div ref={root} className="relative">
      {open && (
        <div
          role="menu"
          aria-label="Ferme et compte"
          className="absolute bottom-full left-0 right-0 mb-2 rounded-2xl border border-border bg-popover p-1 shadow-card"
        >
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="menuitemradio"
              aria-checked={o.id === farmId}
              className={item}
              onClick={() => {
                setFarmId(o.id);
                setOpen(false);
              }}
            >
              <span className="flex-1 truncate">{o.name}</span>
              {o.id === farmId && <Check aria-hidden className="size-4 text-primary" />}
            </button>
          ))}
          <div className="my-1 border-t border-border" />
          <Link to="/compte" role="menuitem" className={item} onClick={() => setOpen(false)}>
            <UserRound aria-hidden className="size-4" />
            Mon compte
          </Link>
          <button type="button" role="menuitem" className={item} onClick={() => void logout()}>
            <LogOut aria-hidden className="size-4" />
            Déconnexion
          </button>
        </div>
      )}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 rounded-xl p-1 text-left hover:bg-ink-soft/60"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
          {initials(user.name)}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-semibold text-white">{user.name}</span>
          <span className="block truncate text-xs text-ink-muted">{activeLabel}</span>
        </span>
        <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-ink-muted" />
      </button>
    </div>
  );
}
