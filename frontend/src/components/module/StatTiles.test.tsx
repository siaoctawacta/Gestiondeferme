import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatTiles } from './StatTiles';

describe('StatTiles', () => {
  it('sizes the figure from the width of its own tile, whatever the text and the screen', () => {
    const { container } = render(<StatTiles tiles={[{ label: 'Montant', value: '1 120 000 FCFA' }, { label: 'Total', value: '12' }]} />);
    // The same classes for a long and a short figure: the layout never depends on the text.
    for (const text of ['1 120 000 FCFA', '12']) {
      const value = screen.getByText(text);
      const classes = value.className.split(' ');
      expect(classes).toContain('min-w-0');
      // A container-query size, capped at the reference 30px and floored at 18px: no breakpoint ladder.
      expect(classes).toContain('[font-size:clamp(1.125rem,12.6cqw,1.875rem)]');
      expect(classes).toContain('leading-[1.2]');
      expect(classes.some((c) => /^(sm|md|lg|xl|min-\[.*\]):text-/.test(c))).toBe(false);
      expect(classes.some((c) => c.includes('overflow-wrap') || c === 'whitespace-nowrap')).toBe(false);
      expect(value.parentElement!.className.split(' ')).toContain('@container');
    }
    expect(container.firstElementChild!.className).not.toContain('max-sm:');
  });

  it('keeps the digits of an amount together and lets only the unit drop to a second line', () => {
    render(<StatTiles tiles={[{ label: 'Montant', value: '12 345 678 FCFA' }, { label: 'Cheptel', value: '3 500 kg' }, { label: 'Taux', value: '12 %' }]} />);
    // Every space inside the number stays a no-break one; the one before a unit made of letters is a plain space.
    expect(screen.getByText(/FCFA/).textContent).toBe('12 345 678 FCFA');
    expect(screen.getByText(/kg/).textContent).toBe('3 500 kg');
    // A percentage is not a unit that wraps.
    expect(screen.getByText(/%/).textContent).toBe('12 %');
  });
});
