import type { KeyboardEvent } from 'react';

export interface TabBarProps {
  tabs: { key: string; label: string }[];
  active: string;
  onChange: (key: string) => void;
  /** Unique prefix (from `useId`) that ties each tab to its panel through `tabId` / `panelId`. */
  idBase: string;
}

export const tabId = (base: string, key: string) => `${base}-tab-${key}`;
export const panelId = (base: string, key: string) => `${base}-panel-${key}`;

/** The pill-shaped tab bar of module and detail pages, with arrow / Home / End keyboard navigation. */
export function TabBar({ tabs, active, onChange, idBase }: TabBarProps) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = tabs.findIndex((t) => t.key === active);
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (at + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (at - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next === null) return;
    e.preventDefault();
    onChange(tabs[next].key);
    document.getElementById(tabId(idBase, tabs[next].key))?.focus();
  };
  return (
    <div role="tablist" onKeyDown={onKeyDown} className="mb-6 inline-flex max-w-full gap-1 overflow-x-auto rounded-full bg-muted p-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          id={tabId(idBase, t.key)}
          type="button"
          role="tab"
          aria-selected={active === t.key}
          aria-controls={panelId(idBase, t.key)}
          tabIndex={active === t.key ? 0 : -1}
          onClick={() => onChange(t.key)}
          className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
            active === t.key ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
