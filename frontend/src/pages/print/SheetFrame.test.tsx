import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PrintOverlay } from './SheetFrame';

afterEach(cleanup);

describe('PrintOverlay', () => {
  it('puts its content in front of the app, marks the body while mounted, and clears the mark on unmount', () => {
    expect(document.body.classList.contains('print-overlay-active')).toBe(false);
    const view = render(<PrintOverlay><p>feuille</p></PrintOverlay>);
    expect(document.body.classList.contains('print-overlay-active')).toBe(true);
    expect(screen.getByText('feuille').closest('.print-overlay')?.parentElement).toBe(document.body);
    view.unmount();
    expect(document.body.classList.contains('print-overlay-active')).toBe(false);
    expect(screen.queryByText('feuille')).not.toBeInTheDocument();
  });

  it('keeps the mark while another overlay is still mounted (counted, not single-instance)', () => {
    const first = render(<PrintOverlay><p>un</p></PrintOverlay>);
    const second = render(<PrintOverlay><p>deux</p></PrintOverlay>);
    first.unmount();
    expect(document.body.classList.contains('print-overlay-active')).toBe(true);
    second.unmount();
    expect(document.body.classList.contains('print-overlay-active')).toBe(false);
  });
});
