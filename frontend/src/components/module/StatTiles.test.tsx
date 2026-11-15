import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { StatTiles } from './StatTiles';

const grid = (container: HTMLElement) => container.firstElementChild as HTMLElement;

describe('StatTiles', () => {
  it('keeps two tiles per row on a phone while every figure is short', () => {
    const { container } = render(<StatTiles tiles={[{ label: 'Total', value: '12' }, { label: 'Payé', value: '0 FCFA' }]} />);
    expect(grid(container).className).toContain('grid-cols-2');
    expect(grid(container).className).not.toContain('max-sm:grid-cols-1');
  });

  it('puts the tiles one per row on a phone when a figure is too long for half a row (1 120 000 FCFA)', () => {
    const { container } = render(<StatTiles tiles={[{ label: 'Montant', value: '1 120 000 FCFA' }, { label: 'Payé', value: '0 FCFA' }]} />);
    expect(grid(container).className).toContain('max-sm:grid-cols-1');
  });
});
