import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatTiles } from './StatTiles';

describe('StatTiles', () => {
  it('lets a figure shrink and wrap inside its tile on a phone whatever its text, and keeps the desktop size', () => {
    const { container } = render(<StatTiles tiles={[{ label: 'Montant', value: '1 120 000 FCFA' }, { label: 'Total', value: '12' }]} />);
    // The same classes for a long and a short figure: the layout never depends on the text.
    for (const text of ['1 120 000 FCFA', '12']) {
      const value = screen.getByText(text);
      expect(value.className).toContain('min-w-0');
      expect(value.className).toContain('text-lg');
      expect(value.className).toContain('sm:text-3xl');
      expect(value.className).toContain('[overflow-wrap:anywhere]');
    }
    expect(container.firstElementChild!.className).not.toContain('max-sm:');
  });
});
