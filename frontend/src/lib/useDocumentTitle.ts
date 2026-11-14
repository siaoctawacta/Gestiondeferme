import { useEffect } from 'react';

export const APP_NAME = 'AgriPilot';

/** Sets the browser tab title to `{page} — AgriPilot`; the one place where document titles are written. */
export function useDocumentTitle(page: string): void {
  useEffect(() => {
    document.title = `${page} — ${APP_NAME}`;
  }, [page]);
}
