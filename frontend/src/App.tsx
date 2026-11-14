import type { ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './lib/auth';
import type { ModuleKey } from './lib/modules';
import { AppLayout } from './components/shell/AppLayout';
import { FarmSwitcher } from './components/shell/FarmSwitcher';
import { NAV } from './components/shell/nav';
import { RequireAuth, RequirePermission } from './components/shell/guards';
import Account from './pages/Account';
import Login from './pages/Login';
import NotFound from './pages/NotFound';
import { ModuleRoute } from './pages/ModuleRoute';
import Farms from './pages/admin/Farms';
import Settings from './pages/admin/Settings';
import Users from './pages/admin/Users';
import { Placeholder } from './pages/Placeholder';
import ResetPassword from './pages/ResetPassword';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

const ITEMS = NAV.flatMap((g) => g.items);

function Guarded({ module }: { module: ModuleKey }) {
  return (
    <RequirePermission module={module}>
      <Placeholder title={ITEMS.find((i) => i.slug === module)!.label} />
    </RequirePermission>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { permissions } = useAuth();
  return (
    <AppLayout permissions={permissions!} alertCount={0} sidebarFooter={<FarmSwitcher />}>
      {children}
    </AppLayout>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/reset/:token" element={<ResetPassword />} />
            <Route
              path="*"
              element={
                <RequireAuth>
                  <Shell>
                    <Routes>
                      <Route path="/" element={<Guarded module="dashboard" />} />
                      <Route path="/alertes" element={<Guarded module="alertes" />} />
                      <Route path="/rapports" element={<Guarded module="rapports" />} />
                      <Route path="/audit" element={<Guarded module="audit" />} />
                      <Route path="/m/:module" element={<ModuleRoute />} />
                      <Route path="/admin/fermes" element={<RequirePermission module="fermes"><Farms /></RequirePermission>} />
                      <Route path="/admin/utilisateurs" element={<RequirePermission module="utilisateurs"><Users /></RequirePermission>} />
                      <Route path="/admin/parametres" element={<RequirePermission module="parametres"><Settings /></RequirePermission>} />
                      <Route path="/compte" element={<Account />} />
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </Shell>
                </RequireAuth>
              }
            />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
