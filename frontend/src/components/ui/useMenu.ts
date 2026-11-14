import { useCallback, useEffect, useRef, type KeyboardEvent } from 'react';

const ITEMS = '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]';

/**
 * Keyboard behaviour of a popup menu: focus moves to the first item on open, arrows / Home / End
 * move between items, Escape closes and focuses the trigger again.
 */
export function useMenu<M extends HTMLElement>(open: boolean, setOpen: (open: boolean) => void) {
  const menuRef = useRef<M | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>(ITEMS)?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  /** Closes the menu and gives focus back to its trigger (after choosing an item). */
  const closeAndFocusTrigger = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, [setOpen]);

  const onMenuKeyDown = (e: KeyboardEvent) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEMS) ?? []);
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = (at + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (at <= 0 ? items.length : at) - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next === null) return;
    e.preventDefault();
    items[next].focus();
  };

  return { menuRef, triggerRef, onMenuKeyDown, closeAndFocusTrigger };
}
