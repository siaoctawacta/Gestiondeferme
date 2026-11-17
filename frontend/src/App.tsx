import { Suspense, type ReactNode } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useParams } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAlerts } from './lib/alerts';
import { AuthProvider, useAuth } from './lib/auth';
import { ErrorBoundary } from './components/ErrorBoundary';
import { lazyRetry } from './components/lazyRetry';
import { AppLayout } from './components/shell/AppLayout';
import { FarmSwitcher } from './components/shell/FarmSwitcher';
import { MessageCard, RequireAuth, RequirePermission } from './components/shell/guards';
import Account from './pages/Account';
import Alerts from './pages/Alerts';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import NotFound from './pages/NotFound';
import { ModuleRoute } from './pages/ModuleRoute';
import QrResolve from './pages/QrResolve';
import ResetPassword from './pages/ResetPassword';
import ScanQr from './pages/ScanQr';
import { Skeleton } from './pages/PageParts';

// Screens that are not the first one seen are fetched when opened, so the main bundle stays small.
const Audit = lazyRetry(() => import('./pages/Audit'));
const Reports = lazyRetry(() => import('./pages/Reports'));
const QuoteDetail = lazyRetry(() => import('./pages/details/QuoteDetail').then((m) => ({ default: m.QuoteDetail })));
const Farms = lazyRetry(() => import('./pages/admin/Farms'));
const Settings = lazyRetry(() => import('./pages/admin/Settings'));
const Users = lazyRetry(() => import('./pages/admin/Users'));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

export function Shell({ children }: { children: ReactNode }) {
  const { permissions, farmId, canSeeAllFarms } = useAuth();
  const { pathname } = useLocation();
  const alerts = useAlerts();
  // Farm data queries stay disabled without a farm: say so instead of showing skeletons forever.
  // The account page does not depend on a farm and stays reachable.
  const noFarm = farmId === null && !canSeeAllFarms && pathname !== '/compte';
  return (
    <AppLayout permissions={permissions!} alertCount={alerts.data?.total ?? 0} sidebarFooter={<FarmSwitcher />}>
      {noFarm ? (
        <MessageCard title="Aucune ferme">Aucune ferme ne vous est attribuée. Contactez un administrateur.</MessageCard>
      ) : (
        <ErrorBoundary resetKey={pathname}>
          <Suspense fallback={<Skeleton aria-busy="true" aria-label="Chargement" className="h-64" />}>{children}</Suspense>
        </ErrorBoundary>
      )}
    </AppLayout>
  );
}

/** `/m/ventes/devis/:id`: the quote's detail screen (a quote has no page of its own in the module registry). */
function QuoteRoute() {
  const { id } = useParams();
  return <QuoteDetail key={id} id={id!} />;
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
                      <Route path="/m/ventes/devis/:id" element={<RequirePermission module="ventes"><QuoteRoute /></RequirePermission>} />
                      <Route path="/m/:module" element={<ModuleRoute />} />
                      <Route path="/m/:module/:id" element={<ModuleRoute />} />
                      <Route path="/admin/fermes" element={<RequirePermission module="fermes"><Farms /></RequirePermission>} />
                      <Route path="/admin/utilisateurs" element={<RequirePermission module="utilisateurs"><Users /></RequirePermission>} />
                      <Route path="/admin/parametres" element={<RequirePermission module="parametres"><Settings /></RequirePermission>} />
                      <Route path="/q/:kind/:id" element={<QrResolve />} />
                      <Route path="/scan" element={<ScanQr />} />
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
