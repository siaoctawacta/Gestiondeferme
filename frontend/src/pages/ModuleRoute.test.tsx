import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ModuleRoute } from './ModuleRoute';

const state = vi.hoisted(() => ({ canRead: true, modules: {} as Record<string, unknown> }));

vi.mock('../lib/auth', () => ({ useAuth: () => ({ can: () => state.canRead }) }));
vi.mock('../modules', () => ({ MODULES: new Proxy({}, { get: (_t, k: string) => state.modules[k] }) }));

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/m/:module" element={<ModuleRoute />} />
        <Route path="/m/:module/:id" element={<ModuleRoute />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.canRead = true;
  state.modules = {};
});

describe('ModuleRoute detail route', () => {
  it('renders the config detail with the id', () => {
    state.modules = { batiments: { detail: ({ id }: { id: string }) => <p>Détail {id}</p> } };
    renderAt('/m/batiments/b42');
    expect(screen.getByText('Détail b42')).toBeInTheDocument();
  });

  it('shows the 404 card when the config has no detail', () => {
    state.modules = { batiments: {} };
    renderAt('/m/batiments/b42');
    expect(screen.getByText('Page introuvable')).toBeInTheDocument();
  });

  it('shows the 404 card for a module without config', () => {
    renderAt('/m/batiments/b42');
    expect(screen.getByText('Page introuvable')).toBeInTheDocument();
  });

  it('refuses without read permission', () => {
    state.canRead = false;
    state.modules = { batiments: { detail: () => <p>Secret</p> } };
    renderAt('/m/batiments/b42');
    expect(screen.getByText('Accès non autorisé')).toBeInTheDocument();
    expect(screen.queryByText('Secret')).not.toBeInTheDocument();
  });
});
