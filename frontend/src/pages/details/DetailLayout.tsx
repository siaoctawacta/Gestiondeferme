import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { StatTiles, type StatTile } from '../../components/module/StatTiles';
import { TabBar, panelId } from '../../components/module/TabBar';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

export interface DetailLayoutProps {
  back: { to: string; label: string };
  /** Page title; also the browser tab title. */
  title: string;
  subtitle?: string;
  /** Pill or badge shown next to the title. */
  status?: ReactNode;
  /** Buttons at the right of the header. */
  actions?: ReactNode;
  /** Tile row under the header. */
  stats?: StatTile[];
  /** Tab bar with one panel each; the first tab is shown first. Without tabs, put the content in `children`. */
  tabs?: { key: string; label: string; content: ReactNode }[];
  children?: ReactNode;
}

/** Layout of a record's detail page: back link, header (same typography as `PageHeader`), stat tiles and tabs. */
export function DetailLayout({ back, title, subtitle, status, actions, stats, tabs, children }: DetailLayoutProps) {
  useDocumentTitle(title);
  const base = useId();
  const [active, setActive] = useState(tabs?.[0]?.key ?? '');
  const current = tabs?.find((t) => t.key === active) ?? tabs?.[0];
  return (
    <>
      <Link to={back.to} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4" />
        {back.label}
      </Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold leading-tight">{title}</h1>
            {status}
          </div>
          {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 print:hidden [&_button]:h-9!">{actions}</div>}
      </div>
      {stats && stats.length > 0 && <StatTiles tiles={stats} />}
      {tabs && tabs.length > 0 && current ? (
        <>
          <TabBar tabs={tabs} active={current.key} onChange={setActive} idBase={base} />
          <div id={panelId(base, current.key)} role="tabpanel" aria-labelledby={`${base}-tab-${current.key}`}>
            {current.content}
          </div>
        </>
      ) : (
        children
      )}
    </>
  );
}
