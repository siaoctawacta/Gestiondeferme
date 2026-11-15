import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../../lib/auth';
import { setAccessToken, setFarmHeader } from '../../lib/api';
import { ActionDialog, type ActionDialogProps } from './ActionDialog';
import type { Field } from './types';

function json(status: number, body?: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const USER = { id: 'u1', name: 'Awa', email: 'awa@x.tg', role: 'DIRECTEUR_FERME', twoFactorEnabled: true };
const fetchMock = vi.fn<typeof fetch>();

const THINGS = [{ id: 'a', name: 'Maïs' }, { id: 'b', name: 'Soja' }];

const items: Field = {
  name: 'items',
  label: 'Composition',
  type: 'lines',
  minRows: 1,
  defaultValue: [{ productId: '', percentage: '' }],
  columns: [
    { name: 'productId', label: 'Produit', type: 'select', required: true, unique: true, options: { endpoint: '/things' } },
    { name: 'percentage', label: 'Pourcentage', type: 'number', required: true, min: 0.01, max: 100, step: 0.01 },
  ],
  footer: (rows) => <p data-testid="footer">{rows.length} ligne(s)</p>,
};

function mount(props: Partial<ActionDialogProps> = {}) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url === '/api/auth/refresh') return json(200, { accessToken: 'acc', user: USER });
    if (url === '/api/auth/me') return json(200, { user: USER, farms: [{ id: 'f1', name: 'Ferme' }], canSeeAllFarms: true, permissions: {} });
    if (url.startsWith('/api/things')) return json(200, { items: THINGS, total: 2, page: 1, pageSize: 200 });
    throw new Error(`unexpected ${url}`);
  });
  const onSubmit = vi.fn(async () => undefined);
  const onDone = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <AuthProvider>
          <ActionDialog title="Test" fields={[items]} onSubmit={onSubmit} onClose={() => undefined} onDone={onDone} {...props} />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onSubmit, onDone };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  setAccessToken(null);
  setFarmHeader(null);
});

describe('LinesField', () => {
  it('adds and removes rows, keeps the minimum, offers a product once and feeds the footer', async () => {
    mount();
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Maïs' })).toBeInTheDocument());
    expect(within(dialog).getByRole('button', { name: 'Retirer la ligne 1' })).toBeDisabled();
    await user.selectOptions(within(dialog).getByLabelText('Produit ligne 1'), 'Maïs');
    await user.click(within(dialog).getByRole('button', { name: 'Ajouter une ligne' }));
    expect(within(dialog).getByTestId('footer')).toHaveTextContent('2 ligne(s)');
    const second = within(dialog).getByLabelText('Produit ligne 2');
    expect(within(second).queryByRole('option', { name: 'Maïs' })).not.toBeInTheDocument();
    expect(within(second).getByRole('option', { name: 'Soja' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Retirer la ligne 2' }));
    expect(within(dialog).queryByLabelText('Produit ligne 2')).not.toBeInTheDocument();
  });

  it('shows the cell errors under the grid and sends nothing', async () => {
    const { onSubmit } = mount();
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Maïs' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByLabelText('Produit ligne 1'), 'Maïs');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    const grid = within(dialog).getByRole('group', { name: 'Composition' });
    expect(await within(grid).findByText('Ligne 1 : le champ « Pourcentage » est requis')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Pourcentage ligne 1'), '150');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(grid).findByText('Ligne 1 : le champ « Pourcentage » doit être inférieur ou égal à 100')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('has no add or remove button when the rows are fixed', async () => {
    mount({ fields: [{ ...items, fixed: true, defaultValue: [{ productId: 'a', percentage: '40' }] } as Field] });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Pourcentage ligne 1')).toHaveValue(40);
    expect(within(dialog).queryByRole('button', { name: 'Ajouter une ligne' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Retirer la ligne 1' })).not.toBeInTheDocument();
  });

  it('refuses fewer rows than minRows', async () => {
    const { onSubmit } = mount({ fields: [{ ...items, defaultValue: [] } as Field] });
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText('Ajoutez au moins une ligne')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('sends the array of rows with numbers coerced', async () => {
    const { onSubmit, onDone } = mount();
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Maïs' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByLabelText('Produit ligne 1'), 'Maïs');
    await user.type(within(dialog).getByLabelText('Pourcentage ligne 1'), '60.5');
    await user.click(within(dialog).getByRole('button', { name: 'Ajouter une ligne' }));
    await user.selectOptions(within(dialog).getByLabelText('Produit ligne 2'), 'Soja');
    await user.type(within(dialog).getByLabelText('Pourcentage ligne 2'), '39.5');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith({ items: [{ productId: 'a', percentage: 60.5 }, { productId: 'b', percentage: 39.5 }] });
  });

  it('treats the array as one value when editing: unchanged is not sent, changed is sent whole', async () => {
    const stored = { items: [{ productId: 'a', percentage: 60, name: 'Maïs' }, { productId: 'b', percentage: 40 }] };
    const first = mount({ mode: 'update', initial: stored });
    const user = userEvent.setup();
    let dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Pourcentage ligne 1')).toHaveValue(60);
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(first.onDone).toHaveBeenCalled());
    expect(first.onSubmit).not.toHaveBeenCalled();

    cleanup();
    const second = mount({ mode: 'update', initial: stored });
    dialog = await screen.findByRole('dialog');
    await user.clear(within(dialog).getByLabelText('Pourcentage ligne 1'));
    await user.type(within(dialog).getByLabelText('Pourcentage ligne 1'), '70');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(second.onSubmit).toHaveBeenCalled());
    expect(second.onSubmit).toHaveBeenCalledWith({ items: [{ productId: 'a', percentage: 70 }, { productId: 'b', percentage: 40 }] });
  });

  it('drops fully empty rows of a non-required grid before counting minRows and building the payload', async () => {
    const optional: Field = {
      name: 'items', label: 'Lignes', type: 'lines', minRows: 1, defaultValue: [{ a: 'x', n: '2' }, { a: '', n: '' }],
      columns: [{ name: 'a', label: 'Texte', type: 'text' }, { name: 'n', label: 'Nombre', type: 'number' }],
    };
    const { onSubmit, onDone } = mount({ fields: [optional] });
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith({ items: [{ a: 'x', n: 2 }] });

    cleanup();
    const empty = mount({ fields: [{ ...optional, defaultValue: [{ a: '', n: '' }] } as Field] });
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Ajoutez au moins une ligne')).toBeInTheDocument();
    expect(empty.onSubmit).not.toHaveBeenCalled();
  });
});
