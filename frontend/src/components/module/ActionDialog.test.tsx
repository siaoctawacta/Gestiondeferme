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

function mount(props: Partial<ActionDialogProps> & { fields: ActionDialogProps['fields'] }) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    urls.push(url);
    if (url === '/api/auth/refresh') return json(200, { accessToken: 'acc', user: USER });
    if (url === '/api/auth/me') return json(200, { user: USER, farms: [{ id: 'f1', name: 'Ferme' }], canSeeAllFarms: true, permissions: {} });
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

describe('ActionDialog: segmented field and value observer', () => {
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

  it('tells the observer the values as they change', async () => {
    const seen: string[] = [];
    mount({ fields, onValues: (v) => { seen.push(String(v.kind)); } });
    await userEvent.setup().click(await screen.findByRole('radio', { name: 'Beta' }));
    expect(seen[0]).toBe('A');
    expect(seen.at(-1)).toBe('B');
  });
});
