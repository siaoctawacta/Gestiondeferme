import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatTiles } from './StatTiles';

describe('StatTiles', () => {
  it('never breaks a figure inside its digits: it scales down by width instead, and keeps the reference size from 1440px', () => {
    const { container } = render(<StatTiles tiles={[{ label: 'Montant', value: '1 120 000 FCFA' }, { label: 'Total', value: '12' }]} />);
    // The same classes for a long and a short figure: the layout never depends on the text.
    for (const text of ['1 120 000 FCFA', '12']) {
      const classes = screen.getByText(text).className.split(' ');
      for (const c of ['min-w-0', 'whitespace-nowrap', 'text-lg', 'sm:text-3xl', 'lg:text-base', 'xl:text-2xl', 'min-[1440px]:text-3xl']) expect(classes).toContain(c);
      expect(classes.some((c) => c.includes('overflow-wrap'))).toBe(false);
    }
    expect(container.firstElementChild!.className).not.toContain('max-sm:');
  });
});
