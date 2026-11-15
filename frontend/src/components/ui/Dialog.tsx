import { useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useFocusTrap } from './useFocusTrap';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Wide panel (`max-w-3xl` instead of `max-w-lg`), for a grid that needs more than ~460px. */
  wide?: boolean;
}

/**
 * Small accessible modal: aria-modal, labelled by title, focus trap, Escape closes. The panel never grows past
 * the viewport: the header stays put and the body scrolls (put the buttons in `DialogActions` to keep them in
 * view).
 */
export function Dialog({ open, onClose, title, children, wide = false }: DialogProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(panel, open, onClose);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/50" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative flex max-h-[calc(100dvh-2rem)] w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} flex-col rounded-[calc(var(--radius)+10px)] bg-card shadow-card outline-none`}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pb-4 pt-6">
          <h2 id={titleId} className="font-display text-xl font-bold">{title}</h2>
          <button
            type="button"
            aria-label="Fermer"
            onClick={onClose}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>
      </div>
    </div>
  );
}

/** The button row at the bottom of a dialog: it sticks to the bottom of the scrolling body, so it is always reachable. */
export function DialogActions({ children }: { children: ReactNode }) {
  return <div className="sticky bottom-0 -mb-6 mt-3 flex justify-end gap-2 bg-card pb-6 pt-3">{children}</div>;
}
