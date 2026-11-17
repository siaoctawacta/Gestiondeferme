import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Puts a sheet in front of the page when printing, for a document printed from a list or a dialog (a credit note),
 * where the screen behind is not a detail page that hides itself: the app root is hidden in print (see `index.css`)
 * and only the sheet is left.
 */
let overlays = 0;

export function PrintOverlay({ children }: { children: ReactNode }) {
  // Counted: the mark stays while any overlay is mounted (two dialogs, a dialog closing while another opens).
  useEffect(() => {
    overlays += 1;
    document.body.classList.add('print-overlay-active');
    return () => {
      overlays -= 1;
      if (overlays === 0) document.body.classList.remove('print-overlay-active');
    };
  }, []);
  return createPortal(<div className="print-overlay">{children}</div>, document.body);
}
