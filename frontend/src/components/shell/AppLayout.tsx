import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import type { Permissions } from '../../lib/modules';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export interface AppLayoutProps {
  permissions: Permissions;
  alertCount: number;
  sidebarFooter?: ReactNode;
  children: ReactNode;
}

export function AppLayout({ permissions, alertCount, sidebarFooter, children }: AppLayoutProps) {
  const [drawer, setDrawer] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setDrawer(false), [pathname]);

  const sidebar = (
    <Sidebar
      permissions={permissions}
      alertCount={alertCount}
      footer={sidebarFooter}
      onNavigate={() => setDrawer(false)}
    />
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="fixed inset-y-0 left-0 z-40 hidden w-64 lg:block">{sidebar}</div>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setDrawer(false)} aria-hidden />
          <div className="relative h-full w-64 max-w-[85vw]">{sidebar}</div>
        </div>
      )}

      <div className="lg:pl-64">
        <Topbar permissions={permissions} alertCount={alertCount} onMenu={() => setDrawer(true)} />
        <main className="px-4 py-8 md:px-8">{children}</main>
      </div>
    </div>
  );
}
