import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { PrintOverlay, usePrintWhenReady } from './SheetFrame';

const print = vi.fn();
beforeEach(() => { print.mockReset(); vi.stubGlobal('print', print); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('usePrintWhenReady', () => {
  it('prints nothing until a print is requested, and nothing while the sheet is not ready', () => {
    const view = renderHook(({ ready, request }) => usePrintWhenReady(ready, request), { initialProps: { ready: true, request: null as unknown } });
    expect(print).not.toHaveBeenCalled();
    view.rerender({ ready: false, request: 1 });
    expect(print).not.toHaveBeenCalled();
    view.rerender({ ready: true, request: 1 });
    expect(print).toHaveBeenCalledOnce();
  });

  it('prints once per request, again for a new one, and not again when only readiness flips', () => {
    const view = renderHook(({ ready, request }) => usePrintWhenReady(ready, request), { initialProps: { ready: true, request: 1 as unknown } });
    view.rerender({ ready: true, request: 1 });
    view.rerender({ ready: false, request: 1 });
    view.rerender({ ready: true, request: 1 });
    expect(print).toHaveBeenCalledOnce();
    view.rerender({ ready: true, request: 2 });
    expect(print).toHaveBeenCalledTimes(2);
  });
});

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
