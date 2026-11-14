import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Suspense } from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { lazyRetry } from './lazyRetry';

let broken = true;
function Child() {
  if (broken) throw new Error('boom');
  return <p>Contenu</p>;
}

beforeEach(() => {
  broken = true;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('ErrorBoundary', () => {
  it('shows the error card when a child throws, and retries on Réessayer', async () => {
    render(<ErrorBoundary><Child /></ErrorBoundary>);
    expect(screen.getByText('Une erreur est survenue lors du chargement.')).toBeInTheDocument();
    broken = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(screen.getByText('Contenu')).toBeInTheDocument();
    expect(screen.queryByText('Une erreur est survenue lors du chargement.')).not.toBeInTheDocument();
  });

  it('keeps the card when the retry fails again', async () => {
    render(<ErrorBoundary><Child /></ErrorBoundary>);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(screen.getByText('Une erreur est survenue lors du chargement.')).toBeInTheDocument();
  });

  it('uses a custom fallback when given', () => {
    render(<ErrorBoundary fallback={() => <p>Plan B</p>}><Child /></ErrorBoundary>);
    expect(screen.getByText('Plan B')).toBeInTheDocument();
  });

  it('resets by itself when resetKey changes', () => {
    const { rerender } = render(<ErrorBoundary resetKey="/a"><Child /></ErrorBoundary>);
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
    broken = false;
    rerender(<ErrorBoundary resetKey="/b"><Child /></ErrorBoundary>);
    expect(screen.getByText('Contenu')).toBeInTheDocument();
  });

  it('re-imports a lazy component whose chunk failed to load', async () => {
    let attempts = 0;
    const Lazy = lazyRetry(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('chunk');
      return { default: () => <p>Graphique</p> };
    });
    render(<ErrorBoundary><Suspense fallback="…"><Lazy /></Suspense></ErrorBoundary>);
    await screen.findByText('Une erreur est survenue lors du chargement.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Graphique')).toBeInTheDocument();
    expect(attempts).toBe(2);
  });
});
