import type { ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAlerts } from './lib/alerts';
import { AuthProvider, useAuth } from './lib/auth';
import { AppLayout } from './components/shell/AppLayout';
import { FarmSwitcher } from './components/shell/FarmSwitcher';
import { RequireAuth, RequirePermission } from './components/shell/guards';
import Account from './pages/Account';
import Alerts from './pages/Alerts';
import Audit from './pages/Audit';
import Dashboard from './pages/Dashboard';
import Reports from './pages/Reports';
import Login from './pages/Login';
import NotFound from './pages/NotFound';
import { ModuleRoute } from './pages/ModuleRoute';
import Farms from './pages/admin/Farms';
import Settings from './pages/admin/Settings';
import Users from './pages/admin/Users';
import ResetPassword from './pages/ResetPassword';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

export function Shell({ children }: { children: ReactNode }) {
  const { permissions } = useAuth();
  const alerts = useAlerts();
  return (
    <AppLayout permissions={permissions!} alertCount={alerts.data?.total ?? 0} sidebarFooter={<FarmSwitcher />}>
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
                      <Route path="/" element={<RequirePermission module="dashboard"><Dashboard /></RequirePermission>} />
                      <Route path="/alertes" element={<RequirePermission module="alertes"><Alerts /></RequirePermission>} />
                      <Route path="/rapports" element={<RequirePermission module="rapports"><Reports /></RequirePermission>} />
                      <Route path="/audit" element={<RequirePermission module="audit"><Audit /></RequirePermission>} />
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
