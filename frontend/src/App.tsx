import { BrowserRouter } from 'react-router';
import { AppLayout } from './components/shell/AppLayout';
import type { Action, ModuleKey, Permissions } from './lib/modules';
import { NAV } from './components/shell/nav';

// Placeholder until auth lands (Task 9): everything readable.
const ALL: Permissions = Object.fromEntries(
  NAV.flatMap((g) => g.items).map((i) => [i.slug as ModuleKey, ['read'] as Action[]]),
) as Permissions;

export default function App() {
  return (
    <BrowserRouter>
      <AppLayout permissions={ALL} alertCount={14}>
        <p className="text-sm text-muted-foreground">Bonjour — Ferme Kpalimé</p>
        <h1 className="text-4xl font-bold">Tableau de bord</h1>
      </AppLayout>
    </BrowserRouter>
  );
}
