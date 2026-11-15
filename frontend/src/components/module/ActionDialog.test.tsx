import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const urls: string[] = [];
/** Permissions of the signed-in user, by module (nothing unless a test grants some). */
let permissions: Record<string, string[]> = {};

function mount(props: Partial<ActionDialogProps> & { fields: ActionDialogProps['fields'] }) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    urls.push(url);
    if (url === '/api/auth/refresh') return json(200, { accessToken: 'acc', user: USER });
    if (url === '/api/auth/me') return json(200, { user: USER, farms: [{ id: 'f1', name: 'Ferme' }], canSeeAllFarms: true, permissions });
    const item = /^\/api\/items\/(\w+)$/.exec(url);
    if (item) return json(200, { batches: [{ id: `b-${item[1]}`, n: Number(item[1].slice(1)) }] });
    if (url.startsWith('/api/zones')) {
      const site = new URL(url, 'http://x').searchParams.get('siteId');
      return json(200, { items: [{ id: `z-${site}`, name: `Zone ${site}` }], total: 1, page: 1, pageSize: 200 });
    }
    throw new Error(`unexpected ${url}`);
  });
  const onSubmit = vi.fn(async () => undefined);
  const onDone = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <AuthProvider>
          <ActionDialog title="Test" onSubmit={onSubmit} onClose={() => undefined} onDone={onDone} {...props} />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onSubmit, onDone };
}

beforeEach(() => {
  urls.length = 0;
  permissions = {};
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  setAccessToken(null);
  setFarmHeader(null);
});

const SITES = [{ value: 's1', label: 'Site Nord' }, { value: 's2', label: 'Site Sud' }];

describe('ActionDialog: dependent selects', () => {
  const fields: Field[] = [
    { name: 'siteId', label: 'Site', type: 'select', options: SITES },
    { name: 'zoneId', label: 'Zone', type: 'select', dependsOn: 'siteId', options: { endpoint: '/zones' } },
  ];

  it('disables the dependent select until the parent has a value, loads with the parent value, clears on change', async () => {
    mount({ fields });
    const dialog = await screen.findByRole('dialog');
    const zone = within(dialog).getByLabelText('Zone');
    expect(zone).toBeDisabled();
    expect(within(zone).getByText("Choisir d'abord Site")).toBeInTheDocument();
    expect(urls.some((u) => u.startsWith('/api/zones'))).toBe(false);
    const user = userEvent.setup();
    await user.selectOptions(within(dialog).getByLabelText('Site'), 'Site Nord');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Zone s1' })).toBeInTheDocument());
    expect(urls.find((u) => u.startsWith('/api/zones'))).toContain('siteId=s1');
    await user.selectOptions(within(dialog).getByLabelText('Zone'), 'Zone s1');
    await user.selectOptions(within(dialog).getByLabelText('Site'), 'Site Sud');
    expect(within(dialog).getByLabelText('Zone')).toHaveValue('');
  });
});

describe('ActionDialog: date defaults', () => {
  it('evaluates a function default each time the dialog opens', async () => {
    let day = '2026-01-02';
    const fields: Field[] = [{ name: 'date', label: 'Date', type: 'date', defaultValue: () => day }];
    mount({ fields });
    expect(await screen.findByLabelText('Date')).toHaveValue('2026-01-02');
    cleanup();
    day = '2026-01-03';
    mount({ fields });
    expect(await screen.findByLabelText('Date')).toHaveValue('2026-01-03');
  });
});

describe('ActionDialog: editing', () => {
  const fields: Field[] = [
    { name: 'name', label: 'Nom', type: 'text', required: true },
    { name: 'note', label: 'Note', type: 'text' },
    { name: 'count', label: 'Nombre', type: 'number' },
    { name: 'day', label: 'Jour', type: 'date', defaultValue: () => '2030-01-01' },
  ];
  const initial = { name: 'Alpha', note: 'à voir', count: 3, day: null };

  it('sends only the changed keys, null for a cleared optional field, and never applies a default to a stored empty value', async () => {
    const { onSubmit, onDone } = mount({ fields, initial, mode: 'update' });
    const dialog = await screen.findByRole('dialog');
    // The stored `null` day stays empty: the default is for creating only.
    expect(within(dialog).getByLabelText('Jour')).toHaveValue('');
    const user = userEvent.setup();
    await user.clear(within(dialog).getByLabelText('Note'));
    await user.clear(within(dialog).getByLabelText('Nombre'));
    await user.type(within(dialog).getByLabelText('Nom'), 'e');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Alphae', note: null, count: null });
  });

  it('sends nothing and closes when nothing changed', async () => {
    const { onSubmit, onDone } = mount({ fields, initial, mode: 'update' });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses to clear a required field', async () => {
    const { onSubmit } = mount({ fields, initial, mode: 'update' });
    const user = userEvent.setup();
    await user.clear(await screen.findByLabelText('Nom'));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Le champ « Nom » est requis')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('compares a custom payload with the stored one', async () => {
    const { onSubmit } = mount({
      fields,
      initial,
      mode: 'update',
      toPayload: (v) => ({ label: `${String(v.name)}!`, total: Number(v.count) || '' }),
    });
    const user = userEvent.setup();
    fireEvent.change(await screen.findByLabelText('Nombre'), { target: { value: '4' } });
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith({ total: 4 });
  });

  it('sends the non-empty values when creating', async () => {
    const { onSubmit } = mount({ fields });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Nom'), 'Beta');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Beta', day: '2030-01-01' });
  });
});

describe('ActionDialog: segmented field', () => {
  const fields: Field[] = [
    {
      name: 'kind', label: 'Genre', type: 'segmented', required: true, defaultValue: 'A',
      options: [{ value: 'A', label: 'Alpha' }, { value: 'B', label: 'Beta' }],
    },
  ];

  it('shows the options as a radio group with the default checked, and sends the chosen value', async () => {
    const { onSubmit } = mount({ fields });
    const group = await screen.findByRole('radiogroup', { name: 'Genre' });
    expect(within(group).getByRole('radio', { name: 'Alpha' })).toBeChecked();
    const user = userEvent.setup();
    await user.click(within(group).getByRole('radio', { name: 'Beta' }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ kind: 'B' }));
  });
});

describe('ActionDialog: select with a path template', () => {
  const fields: Field[] = [
    { name: 'itemId', label: 'Article', type: 'select', options: [{ value: 'i1', label: 'Article 1' }, { value: 'i2', label: 'Article 2' }] },
    {
      name: 'batchId', label: 'Lot', type: 'select', dependsOn: 'itemId',
      options: {
        endpoint: '/items/{itemId}',
        select: (data) => (data as { batches: { id: string; n: number }[] }).batches.map((b) => ({ value: b.id, label: `lot ${b.n}` })),
      },
    },
  ];

  it('waits for the parent without a request, loads the resolved path mapped to options, and clears on a parent change', async () => {
    mount({ fields });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Lot')).toBeDisabled();
    expect(urls.some((u) => u.startsWith('/api/items'))).toBe(false);
    const user = userEvent.setup();
    await user.selectOptions(within(dialog).getByLabelText('Article'), 'Article 1');
    await within(dialog).findByRole('option', { name: 'lot 1' });
    // The parent value is part of the path, not a query parameter.
    expect(urls.find((u) => u.startsWith('/api/items'))).toBe('/api/items/i1');
    await user.selectOptions(within(dialog).getByLabelText('Lot'), 'lot 1');
    await user.selectOptions(within(dialog).getByLabelText('Article'), 'Article 2');
    expect(within(dialog).getByLabelText('Lot')).toHaveValue('');
    await within(dialog).findByRole('option', { name: 'lot 2' });
    expect(urls).toContain('/api/items/i2');
  });

  it('maps a fixed endpoint (no parent) too', async () => {
    mount({
      fields: [{ name: 'batchId', label: 'Lot', type: 'select', options: { endpoint: '/items/i3', select: (d) => (d as { batches: { id: string; n: number }[] }).batches.map((b) => ({ value: b.id, label: `lot ${b.n}` })) } }],
    });
    expect(await screen.findByRole('option', { name: 'lot 3' })).toBeInTheDocument();
  });
});

describe('ActionDialog: dependent values never go stale', () => {
  const D = [{ value: 'd1', label: 'D1' }, { value: 'd2', label: 'D2' }];
  const P = [{ value: 'p1', label: 'P1' }, { value: 'p2', label: 'P2' }];

  it('clears a dependent value when its parent changes while the dependent is hidden, and never sends a hidden field', async () => {
    const fields = (v: Record<string, unknown>): Field[] => [
      { name: 'mode', label: 'Mode', type: 'segmented', defaultValue: 'A', options: [{ value: 'A', label: 'Avec' }, { value: 'B', label: 'Sans' }] },
      { name: 'p', label: 'Parent', type: 'select', options: P },
      ...((v.mode ?? 'A') === 'A' ? [{ name: 'd', label: 'Enfant', type: 'select', dependsOn: 'p', options: D } as Field] : []),
    ];
    const { onSubmit } = mount({ fields });
    const dialog = await screen.findByRole('dialog');
    const user = userEvent.setup();
    await user.selectOptions(within(dialog).getByLabelText('Parent'), 'P1');
    await user.selectOptions(within(dialog).getByLabelText('Enfant'), 'D1');
    await user.click(within(dialog).getByRole('radio', { name: 'Sans' }));
    expect(within(dialog).queryByLabelText('Enfant')).toBeNull();
    // Hidden: not sent.
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ mode: 'B', p: 'p1' }));
    onSubmit.mockClear();
    await user.selectOptions(within(dialog).getByLabelText('Parent'), 'P2');
    await user.click(within(dialog).getByRole('radio', { name: 'Avec' }));
    expect(within(dialog).getByLabelText('Enfant')).toHaveValue('');
  });

  it('clears a dependent value when its dependsOn moves to another field', async () => {
    const fields = (v: Record<string, unknown>): Field[] => [
      { name: 'mode', label: 'Mode', type: 'segmented', defaultValue: 'A', options: [{ value: 'A', label: 'Avec' }, { value: 'B', label: 'Sans' }] },
      { name: 'pa', label: 'Parent A', type: 'select', options: P },
      { name: 'pb', label: 'Parent B', type: 'select', options: P },
      { name: 'd', label: 'Enfant', type: 'select', dependsOn: (v.mode ?? 'A') === 'A' ? 'pa' : 'pb', options: D },
    ];
    const { onSubmit } = mount({ fields });
    const dialog = await screen.findByRole('dialog');
    const user = userEvent.setup();
    await user.selectOptions(within(dialog).getByLabelText('Parent A'), 'P1');
    await user.selectOptions(within(dialog).getByLabelText('Parent B'), 'P1');
    await user.selectOptions(within(dialog).getByLabelText('Enfant'), 'D1');
    await user.click(within(dialog).getByRole('radio', { name: 'Sans' }));
    // Same parent value, but another parent field: the choice made for the first one does not carry over.
    expect(within(dialog).getByLabelText('Enfant')).toHaveValue('');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ mode: 'B', pa: 'p1', pb: 'p1' }));
  });

  it('clears a stored dependent value when its parent is changed', async () => {
    const fields: Field[] = [
      { name: 'p', label: 'Parent', type: 'select', options: P },
      { name: 'd', label: 'Enfant', type: 'select', dependsOn: 'p', options: D },
    ];
    mount({ fields, initial: { p: 'p1', d: 'd1' }, mode: 'update' });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Enfant')).toHaveValue('d1');
    await userEvent.setup().selectOptions(within(dialog).getByLabelText('Parent'), 'P2');
    expect(within(dialog).getByLabelText('Enfant')).toHaveValue('');
  });
});

describe('ActionDialog: options that need a permission', () => {
  it('makes no request without the permission and keeps the stored value, disabled', async () => {
    const fields: Field[] = [{
      name: 'zoneId', label: 'Zone', type: 'select', options: { endpoint: '/zones' }, optionsPermission: { module: 'stocks', action: 'read' },
    }];
    const { onSubmit } = mount({ fields, initial: { zoneId: 'z9' } });
    const select = await screen.findByLabelText('Zone');
    expect(select).toBeDisabled();
    expect(select).toHaveValue('z9');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ zoneId: 'z9' }));
    expect(urls.some((u) => u.startsWith('/api/zones'))).toBe(false);
  });

  it('does the same for a cell of a lines grid', async () => {
    const fields: Field[] = [{
      name: 'rows', label: 'Lignes', type: 'lines',
      columns: [{ name: 'zoneId', label: 'Zone', type: 'select', options: { endpoint: '/zones' }, optionsPermission: { module: 'stocks', action: 'read' } }],
    }];
    mount({ fields, initial: { rows: [{ zoneId: 'z9' }] }, mode: 'update' });
    const select = await screen.findByLabelText('Zone ligne 1');
    expect(select).toBeDisabled();
    expect(select).toHaveValue('z9');
    expect(urls.some((u) => u.startsWith('/api/zones'))).toBe(false);
  });
});

describe('ActionDialog: required select columns whose options need a permission', () => {
  const grid = (): Field[] => [{
    name: 'rows', label: 'Lignes', type: 'lines',
    columns: [
      { name: 'zoneId', label: 'Zone', type: 'select', required: true, options: { endpoint: '/zones' }, optionsPermission: { module: 'stocks', action: 'read' } },
      { name: 'qty', label: 'Quantité', type: 'number' },
    ],
  }];

  it('is still required for a user who holds the permission', async () => {
    permissions = { stocks: ['read'] };
    const { onSubmit } = mount({ fields: grid(), initial: { rows: [{ zoneId: '', qty: '1' }] } });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Ligne 1 : le champ « Zone » est requis')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('is not required without the permission: the stored value is kept and resent unchanged', async () => {
    const { onSubmit } = mount({ fields: grid(), mode: 'update', initial: { rows: [{ zoneId: 'z9', qty: '1' }, { zoneId: '', qty: '2' }] } });
    expect(await screen.findByLabelText('Zone ligne 1')).toBeDisabled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Enregistrer' }));
    // Nothing changed: the stored rows go through validation (no « requis » on the unreadable column) and no request is made.
    await waitFor(() => expect(screen.queryByText(/est requis/)).not.toBeInTheDocument());
    expect(onSubmit).not.toHaveBeenCalled();
    cleanup();
    const created = mount({ fields: grid(), initial: { rows: [{ zoneId: 'z9', qty: '1' }, { zoneId: '', qty: '2' }] } });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(created.onSubmit).toHaveBeenCalledWith({ rows: [{ zoneId: 'z9', qty: 1 }, { qty: 2 }] }));
  });
});

describe('ActionDialog: fields function and defaults', () => {
  const dynamic = (seen: Record<string, unknown>[]) => (values: Record<string, unknown>): Field[] => {
    seen.push(values);
    return [
      { name: 'kind', label: 'Genre', type: 'select', defaultValue: 'A', options: [{ value: 'A', label: 'Alpha' }, { value: 'B', label: 'Bravo' }] },
      ...(values.kind === 'A' ? [{ name: 'alpha', label: 'Détail alpha', type: 'text' } as Field] : []),
      ...(values.kind === 'B' ? [{ name: 'bravo', label: 'Détail bravo', type: 'text' } as Field] : []),
    ];
  };

  it('hands the defaults of the fields to the function when creating (no fallback needed)', async () => {
    const seen: Record<string, unknown>[] = [];
    mount({ fields: dynamic(seen) });
    expect(await screen.findByLabelText('Détail alpha')).toBeInTheDocument();
    expect(screen.queryByLabelText('Détail bravo')).not.toBeInTheDocument();
    expect(seen.at(-1)).toMatchObject({ kind: 'A' });
    await userEvent.setup().selectOptions(screen.getByLabelText('Genre'), 'Bravo');
    expect(await screen.findByLabelText('Détail bravo')).toBeInTheDocument();
    expect(screen.queryByLabelText('Détail alpha')).not.toBeInTheDocument();
  });

  it('does not apply a default when editing: the stored value rules, an empty one stays empty', async () => {
    const seen: Record<string, unknown>[] = [];
    mount({ fields: dynamic(seen), mode: 'update', initial: { kind: null } });
    expect(await screen.findByLabelText('Genre')).toHaveValue('');
    expect(screen.queryByLabelText('Détail alpha')).not.toBeInTheDocument();
    expect(seen.at(-1)).toMatchObject({ kind: '' });
  });
});

describe('ActionDialog: a stored select value the options no longer offer', () => {
  const fields: Field[] = [
    { name: 'zoneId', label: 'Zone', type: 'select', options: { endpoint: '/zones' } },
    { name: 'siteId', label: 'Site', type: 'select', options: SITES },
    { name: 'note', label: 'Note', type: 'text' },
  ];

  it('stays the current choice (not « Sélectionner… ») and is kept when the rest is edited', async () => {
    const { onSubmit } = mount({ fields, mode: 'update', initial: { zoneId: 'z-gone', siteId: 's9', note: '' } });
    const zone = await screen.findByLabelText('Zone');
    await waitFor(() => expect(within(zone).getByRole('option', { name: 'Zone null' })).toBeInTheDocument());
    expect(zone).toHaveValue('z-gone');
    expect(within(zone).getByRole('option', { name: 'Valeur actuelle' })).toBeDisabled();
    expect(screen.getByLabelText('Site')).toHaveValue('s9');
    expect(within(screen.getByLabelText('Site')).getByRole('option', { name: 'Valeur actuelle' })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Note'), 'ok');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ note: 'ok' }));
  });

  it('does not add the option for a value the options still offer, nor for an empty one', async () => {
    mount({ fields: [fields[1]], mode: 'update', initial: { siteId: 's1' } });
    const site = await screen.findByLabelText('Site');
    expect(site).toHaveValue('s1');
    expect(within(site).queryByRole('option', { name: 'Valeur actuelle' })).not.toBeInTheDocument();
    cleanup();
    mount({ fields: [fields[1]], mode: 'update', initial: { siteId: null } });
    const empty = await screen.findByLabelText('Site');
    expect(within(empty).queryByRole('option', { name: 'Valeur actuelle' })).not.toBeInTheDocument();
  });
});

describe('ActionDialog: dialog width', () => {
  it('is the default width unless `wide` is given (a grid of more than three columns)', async () => {
    mount({ fields: [{ name: 'note', label: 'Note', type: 'text' }] });
    expect((await screen.findByRole('dialog')).className).toContain('max-w-lg');
    cleanup();
    mount({ fields: [{ name: 'note', label: 'Note', type: 'text' }], wide: true });
    const wide = (await screen.findByRole('dialog')).className;
    expect(wide).toContain('max-w-3xl');
    expect(wide).not.toContain('max-w-lg');
  });
});

describe('ActionDialog: three-level chains and required options', () => {
  const OPTS = (p: string) => [{ value: `${p}1`, label: `${p.toUpperCase()}1` }, { value: `${p}2`, label: `${p.toUpperCase()}2` }];
  const chain: Field[] = [
    { name: 'a', label: 'Niveau A', type: 'select', options: OPTS('a') },
    { name: 'b', label: 'Niveau B', type: 'select', dependsOn: 'a', options: OPTS('b') },
    { name: 'c', label: 'Niveau C', type: 'select', dependsOn: 'b', options: OPTS('c') },
  ];

  it('does not bring back the grandchild value when the cleared middle value is picked again', async () => {
    const { onSubmit } = mount({ fields: chain });
    const dialog = await screen.findByRole('dialog');
    const user = userEvent.setup();
    await user.selectOptions(within(dialog).getByLabelText('Niveau A'), 'A1');
    await user.selectOptions(within(dialog).getByLabelText('Niveau B'), 'B1');
    await user.selectOptions(within(dialog).getByLabelText('Niveau C'), 'C1');
    await user.selectOptions(within(dialog).getByLabelText('Niveau A'), 'A2');
    expect(within(dialog).getByLabelText('Niveau B')).toHaveValue('');
    await user.selectOptions(within(dialog).getByLabelText('Niveau B'), 'B1');
    expect(within(dialog).getByLabelText('Niveau C')).toHaveValue('');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ a: 'a2', b: 'b1' }));
  });

  it('does not block on a required select whose options the user may not read', async () => {
    const fields: Field[] = [
      { name: 'zoneId', label: 'Zone', type: 'select', required: true, options: { endpoint: '/zones' }, optionsPermission: { module: 'stocks', action: 'read' } },
      { name: 'note', label: 'Note', type: 'text' },
    ];
    const { onSubmit } = mount({ fields });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({}));
    expect(urls.some((u) => u.startsWith('/api/zones'))).toBe(false);
  });
});

describe('ActionDialog: fixed lines keep what the stored rows say beyond the columns', () => {
  const fixed: Field = {
    name: 'lines', label: 'Lignes', type: 'lines', fixed: true,
    columns: [
      { name: 'designation', label: 'Désignation', type: 'text', readOnly: true },
      { name: 'quantity', label: 'Quantité', type: 'number' },
    ],
  };
  const initial = { lines: [{ lineId: 'ln1', designation: 'Poulets', quantity: '', unitPrice: 3500 }] };

  it('hands the extra keys (as strings) to toPayload, and never sends them by default', async () => {
    const toPayload = vi.fn((v: Record<string, unknown>) => ({ ids: (v.lines as Record<string, string>[]).map((r) => `${r.lineId}:${r.unitPrice}`) }));
    const { onSubmit } = mount({ fields: [fixed], initial, toPayload });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ ids: ['ln1:3500'] }));
  });

  it('leaves them out of the default payload', async () => {
    const { onSubmit } = mount({ fields: [fixed], initial });
    const dialog = await screen.findByRole('dialog');
    await userEvent.setup().type(within(dialog).getByLabelText('Quantité ligne 1'), '4');
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ lines: [{ designation: 'Poulets', quantity: 4 }] }));
  });
});
