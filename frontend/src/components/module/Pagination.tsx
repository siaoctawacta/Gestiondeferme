import { Button } from '../ui/Button';

export const pageCount = (total: number, pageSize: number): number => Math.max(1, Math.ceil(total / pageSize));

export interface PaginationProps {
  page: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
}

/** "Page n sur N" with previous / next; renders nothing when everything fits on one page. */
export function Pagination({ page, total, pageSize, onPage }: PaginationProps) {
  if (total <= pageSize) return null;
  const pages = pageCount(total, pageSize);
  return (
    <div className="flex items-center justify-between border-t border-border p-4 text-sm">
      <span className="text-muted-foreground">Page {page} sur {pages}</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Précédent</Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Suivant</Button>
      </div>
    </div>
  );
}
