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

/* ---------------------------------------------------------------------------------------------
 * Row-dependent cells: a `lines` column whose options come from another cell of the same row.
 * ------------------------------------------------------------------------------------------- */

const KINDS = [{ value: 'LOT', label: 'Lot' }, { value: 'OEUFS', label: 'Œufs' }, { value: 'SERVICE', label: 'Prestation' }];
const SELLABLES: Record<string, unknown[]> = {
  LOT: [
    { id: 'l1', label: 'LC-2026-14 — Poulets de chair', designation: 'Poulets de chair', sellable: true, reason: null },
    { id: 'l2', label: 'LC-2026-15 — Poulets de chair', designation: 'Poulets de chair', sellable: true, reason: null },
    { id: 'l3', label: 'LT-9 — Poussins', designation: 'Poussins', sellable: false, reason: "Délai d'attente jusqu'au 2026-11-20" },
  ],
  OEUFS: [{ id: 'e1', label: 'LP-2026-03 — 4 710 œufs disponibles', designation: 'Œufs (plateau)', sellable: true, reason: null }],
};
type Sellable = { id: string; label: string; designation: string; sellable: boolean; reason: string | null };

const rowLines = (over: Partial<Extract<Field, { type: 'lines' }>> = {}, permission = false): Field => ({
  name: 'lines',
  label: 'Lignes',
  type: 'lines',
  minRows: 1,
  defaultValue: [{ kind: '', sourceId: '', designation: '', unit: '' }],
  columns: [
    { name: 'kind', label: 'Type', type: 'select', required: true, options: KINDS },
    {
      name: 'sourceId',
      label: 'Source',
      type: 'select',
      required: true,
      dependsOnCell: 'kind',
      optionsPermission: permission ? { module: 'ventes', action: 'create' } : undefined,
      options: (row) => (row.kind && row.kind !== 'SERVICE'
        ? {
            endpoint: '/sellables',
            params: { kind: row.kind },
            select: (data) => (data as { items: Sellable[] }).items.map((s) => ({
              value: s.id, label: s.sellable ? s.label : `${s.label} (${s.reason})`, disabled: !s.sellable, data: s,
            })),
          }
        : null),
      onPick: (option, row) => ({
        designation: (option.data as Sellable).designation,
        ...(row.kind === 'OEUFS' ? { unit: 'PLATEAU' } : {}),
      }),
    },
    { name: 'designation', label: 'Désignation', type: 'text', required: true },
    {
      name: 'unit',
      label: 'Unité',
      type: 'select',
      dependsOnCell: 'kind',
      options: (row) => (row.kind === 'OEUFS' ? [{ value: 'PLATEAU', label: 'Plateau' }, { value: 'OEUF', label: 'Œuf' }] : null),
    },
  ],
  ...over,
} as Field);

describe('LinesField, row-dependent cells', () => {
  const sellableCalls = () => fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/api/sellables'));

  function mountRows(field: Field, { perms = ['create'], initial }: { perms?: string[]; initial?: Record<string, unknown> } = {}) {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/auth/refresh') return json(200, { accessToken: 'acc', user: USER });
      if (url === '/api/auth/me') {
        return json(200, { user: USER, farms: [{ id: 'f1', name: 'Ferme' }], canSeeAllFarms: true, permissions: { ventes: perms } });
      }
      if (url.startsWith('/api/sellables')) {
        const kind = new URL(url, 'http://x').searchParams.get('kind') ?? '';
        return json(200, { items: SELLABLES[kind] ?? [] });
      }
      throw new Error(`unexpected ${url}`);
    });
    const onSubmit = vi.fn(async () => undefined);
    const onDone = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <AuthProvider>
            <ActionDialog title="Test" fields={[field]} initial={initial} mode={initial ? 'update' : 'create'} onSubmit={onSubmit} onClose={() => undefined} onDone={onDone} />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return { onSubmit, onDone };
  }

  it('is disabled and shows — until the type of its row is chosen, then loads the options of that type once', async () => {
    mountRows(rowLines());
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog');
    const source = within(dialog).getByLabelText('Source ligne 1');
    expect(source).toBeDisabled();
    expect(source).toHaveDisplayValue('—');
    expect(within(dialog).getByLabelText('Unité ligne 1')).toBeDisabled();
    expect(sellableCalls()).toEqual([]);

    await user.selectOptions(within(dialog).getByLabelText('Type ligne 1'), 'Lot');
    await waitFor(() => expect(within(dialog).getByLabelText('Source ligne 1')).toBeEnabled());
    expect(await within(dialog).findByRole('option', { name: 'LC-2026-14 — Poulets de chair' })).toBeInTheDocument();
    expect(sellableCalls()).toEqual(['/api/sellables?kind=LOT']);
    // A prestation has no source: the cell goes back to —.
    await user.selectOptions(within(dialog).getByLabelText('Type ligne 1'), 'Prestation');
    expect(within(dialog).getByLabelText('Source ligne 1')).toBeDisabled();
    expect(within(dialog).getByLabelText('Source ligne 1')).toHaveDisplayValue('—');
  });

  it('fetches the options once per distinct path, whatever the number of rows', async () => {
    mountRows(rowLines({ defaultValue: [{ kind: 'LOT' }, { kind: 'LOT' }, { kind: 'OEUFS' }] }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getAllByRole('option', { name: 'LC-2026-14 — Poulets de chair' })).toHaveLength(2));
    expect(within(dialog).getByRole('option', { name: 'LP-2026-03 — 4 710 œufs disponibles' })).toBeInTheDocument();
    expect([...sellableCalls()].sort()).toEqual(['/api/sellables?kind=LOT', '/api/sellables?kind=OEUFS']);
  });

  it('offers an option the loader marks disabled, and refuses to pick it', async () => {
    mountRows(rowLines({ defaultValue: [{ kind: 'LOT' }] }));
    const dialog = await screen.findByRole('dialog');
    const blocked = await within(dialog).findByRole('option', { name: "LT-9 — Poussins (Délai d'attente jusqu'au 2026-11-20)" });
    expect(blocked).toBeDisabled();
    expect(within(dialog).getByRole('option', { name: 'LC-2026-15 — Poulets de chair' })).toBeEnabled();
  });

  it('clears the dependent cells of the row whose type changed, and of that row only', async () => {
    mountRows(rowLines({ defaultValue: [{ kind: 'LOT', designation: 'A' }, { kind: 'LOT', designation: 'B' }] }));
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getAllByRole('option', { name: 'LC-2026-14 — Poulets de chair' })).toHaveLength(2));
    await user.selectOptions(within(dialog).getByLabelText('Source ligne 1'), 'l1');
    await user.selectOptions(within(dialog).getByLabelText('Source ligne 2'), 'l2');
    await user.selectOptions(within(dialog).getByLabelText('Type ligne 1'), 'Œufs');
    await waitFor(() => expect(within(dialog).getByLabelText('Source ligne 1')).toHaveValue(''));
    expect(within(dialog).getByLabelText('Source ligne 2')).toHaveValue('l2');
    // The designation is not a dependent cell: it stays.
    expect(within(dialog).getByLabelText('Désignation ligne 1')).toHaveValue('Poulets de chair');
    // A source picked after the change is live.
    await user.selectOptions(within(dialog).getByLabelText('Source ligne 1'), 'e1');
    expect(within(dialog).getByLabelText('Source ligne 1')).toHaveValue('e1');
    expect(within(dialog).getByLabelText('Source ligne 2')).toHaveValue('l2');
  });

  it('prefills the sibling cells of the picked option, and the prefill survives the type it was chosen under', async () => {
    const { onSubmit, onDone } = mountRows(rowLines({ defaultValue: [{ kind: '' }] }));
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Type ligne 1'), 'Œufs');
    await user.selectOptions(await within(dialog).findByLabelText('Source ligne 1'), 'e1');
    expect(within(dialog).getByLabelText('Désignation ligne 1')).toHaveValue('Œufs (plateau)');
    expect(within(dialog).getByLabelText('Unité ligne 1')).toHaveValue('PLATEAU');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith({ lines: [{ kind: 'OEUFS', sourceId: 'e1', designation: 'Œufs (plateau)', unit: 'PLATEAU' }] });
  });

  it('leaves a cell without options out of the payload and does not require it', async () => {
    const { onSubmit, onDone } = mountRows(rowLines({ defaultValue: [{ kind: 'SERVICE', sourceId: 'stale', designation: 'Transport', unit: 'OEUF' }] }));
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith({ lines: [{ kind: 'SERVICE', designation: 'Transport' }] });
  });

  it('keeps a stored value until its type changes, and resends it unchanged', async () => {
    const stored = { lines: [{ kind: 'LOT', sourceId: 'gone', designation: 'Poulets', unit: '' }] };
    const { onSubmit, onDone } = mountRows(rowLines(), { initial: stored });
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'LC-2026-14 — Poulets de chair' })).toBeInTheDocument());
    expect(within(dialog).getByLabelText('Source ligne 1')).toHaveValue('gone');
    expect(within(dialog).getByRole('option', { name: 'Valeur actuelle' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onSubmit).not.toHaveBeenCalled();

    cleanup();
    const second = mountRows(rowLines(), { initial: stored });
    const again = await screen.findByRole('dialog');
    await user.selectOptions(within(again).getByLabelText('Type ligne 1'), 'Œufs');
    await waitFor(() => expect(within(again).getByLabelText('Source ligne 1')).toHaveValue(''));
    await user.click(within(again).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(again).findByText('Ligne 1 : le champ « Source » est requis')).toBeInTheDocument();
    expect(second.onSubmit).not.toHaveBeenCalled();
  });

  it('keeps each remaining row\'s stored values when another row is removed', async () => {
    const stored = { lines: [{ kind: 'LOT', sourceId: 'gone1', designation: 'A', unit: '' }, { kind: 'LOT', sourceId: 'gone2', designation: 'B', unit: '' }] };
    mountRows(rowLines(), { initial: stored });
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Type ligne 1'), 'Œufs');
    await waitFor(() => expect(within(dialog).getByLabelText('Source ligne 1')).toHaveValue(''));
    expect(within(dialog).getByLabelText('Source ligne 2')).toHaveValue('gone2');
    await user.click(within(dialog).getByRole('button', { name: 'Retirer la ligne 1' }));
    expect(within(dialog).getByLabelText('Désignation ligne 1')).toHaveValue('B');
    expect(within(dialog).getByLabelText('Source ligne 1')).toHaveValue('gone2');
  });

  it('honours optionsPermission: no request, the cell is disabled and keeps its value, not required', async () => {
    const { onSubmit, onDone } = mountRows(
      rowLines({ defaultValue: [{ kind: 'LOT', sourceId: 'l9', designation: 'A', unit: '' }] }, true),
      { perms: ['read'] },
    );
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByLabelText('Source ligne 1')).toBeDisabled());
    expect(within(dialog).getByLabelText('Source ligne 1')).toHaveValue('l9');
    expect(within(dialog).getByRole('option', { name: 'Valeur conservée' })).toBeInTheDocument();
    expect(sellableCalls()).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith({ lines: [{ kind: 'LOT', sourceId: 'l9', designation: 'A' }] });
  });
});
