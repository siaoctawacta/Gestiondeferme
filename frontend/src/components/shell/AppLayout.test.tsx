import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { AppLayout } from './AppLayout';
import type { Action, Permissions } from '../../lib/modules';

const permissions = { dashboard: ['read'] as Action[], alertes: ['read'] as Action[] } as unknown as Permissions;

function mount() {
  render(
    <MemoryRouter>
      <AppLayout permissions={permissions} alertCount={3}>
        <p>page</p>
      </AppLayout>
    </MemoryRouter>,
  );
}

describe('mobile drawer', () => {
  it('moves focus in, traps it, closes on Escape and restores focus to the menu button', async () => {
    mount();
    const user = userEvent.setup();
    const menuButton = screen.getByRole('button', { name: 'Ouvrir le menu' });
    await user.click(menuButton);
    const drawer = screen.getByRole('dialog', { name: 'Menu' });
    expect(drawer).toContainElement(document.activeElement as HTMLElement);

    for (let i = 0; i < 6; i += 1) {
      await user.tab();
      expect(drawer).toContainElement(document.activeElement as HTMLElement);
    }
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument();
    expect(menuButton).toHaveFocus();
  });
});
