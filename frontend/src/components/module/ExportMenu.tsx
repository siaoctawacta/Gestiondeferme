import { useState } from 'react';
import { Download } from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../ui/Button';
import { errorMessage } from './errorMessage';

export interface ExportMenuProps {
  endpoint: string;
  filename: string;
  params: Record<string, string | undefined>;
  onError: (message: string) => void;
}

const FORMATS = [
  { format: 'csv', label: 'CSV' },
  { format: 'xlsx', label: 'Excel' },
] as const;

export function ExportMenu({ endpoint, filename, params, onError }: ExportMenuProps) {
  const [open, setOpen] = useState(false);

  const run = async (format: 'csv' | 'xlsx') => {
    setOpen(false);
    try {
      await api.download(endpoint, { ...params, format }, `${filename}.${format}`);
    } catch (e) {
      onError(errorMessage(e));
    }
  };

  return (
    <div className="relative">
      <Button variant="outline" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Download aria-hidden className="size-4" />
        Exporter
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <ul
            role="menu"
            onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
            className="absolute right-0 top-12 z-20 min-w-36 overflow-hidden rounded-2xl border border-border bg-card py-1 shadow-card"
          >
            {FORMATS.map((f) => (
              <li key={f.format} role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => run(f.format)}
                  className="block w-full px-4 py-2 text-left text-sm hover:bg-muted"
                >
                  {f.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
