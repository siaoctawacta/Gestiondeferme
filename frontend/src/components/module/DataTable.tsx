import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronDown, ChevronUp, Pencil, QrCode, Trash2 } from 'lucide-react';
import { Table, TD, TH, THead, TR } from '../ui/Table';
import { Pill } from '../ui/Pill';
import type { Column, StatusDef } from './types';

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

export interface DataTableProps<T extends { id: string }> {
  columns: Column<T>[];
  rows: T[];
  loading: boolean;
  statuses?: StatusDef[];
  statusKey?: keyof T;
  sort: SortState | null;
  onSort: (key: string) => void;
  detailPath?: (row: T) => string;
  qr?: boolean;
  extraActions?: (row: T) => ReactNode;
  onEdit?: (row: T) => void;
  onDelete?: (row: T) => void;
}

const ICON_BUTTON =
  'inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring';

export const ActionButton = ({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) => (
  <button type="button" aria-label={label} title={label} onClick={onClick} className={ICON_BUTTON}>
    {children}
  </button>
);

function cell<T extends { id: string }>(
  row: T, col: Column<T>, statuses?: StatusDef[], statusKey?: keyof T,
): ReactNode {
  if (col.render) return col.render(row);
  const value = (row as Record<string, unknown>)[col.key];
  if (statuses && statusKey === col.key) {
    const def = statuses.find((s) => s.value === value);
    if (def) return <Pill tone={def.tone}>{def.label}</Pill>;
  }
  return value === null || value === undefined ? '' : String(value);
}

const SKELETON_ROWS = 5;

export function DataTable<T extends { id: string }>({
  columns, rows, loading, statuses, statusKey, sort, onSort, detailPath, qr, extraActions, onEdit, onDelete,
}: DataTableProps<T>) {
  const hasActions = Boolean(qr || extraActions || onEdit || onDelete);
  const span = columns.length + (hasActions ? 1 : 0);

  return (
    <Table>
      <THead>
        <TR>
          {columns.map((c) => {
            const active = sort?.key === c.key;
            return (
              <TH
                key={c.key}
                className={c.align === 'right' ? 'text-right' : ''}
                aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
              >
                {c.sortable ? (
                  <button type="button" onClick={() => onSort(c.key)} className="inline-flex items-center gap-1 uppercase tracking-wider">
                    {c.header}
                    {active && (sort!.dir === 'asc' ? <ChevronUp aria-hidden className="size-3" /> : <ChevronDown aria-hidden className="size-3" />)}
                  </button>
                ) : (
                  c.header
                )}
              </TH>
            );
          })}
          {hasActions && <TH><span className="sr-only">Actions</span></TH>}
        </TR>
      </THead>
      <tbody>
        {loading &&
          Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <TR key={i} data-testid="skeleton-row">
              <TD colSpan={span}>
                <div className="h-5 animate-pulse rounded-full bg-muted" />
              </TD>
            </TR>
          ))}
        {!loading && rows.length === 0 && (
          <TR>
            <TD colSpan={span} className="py-10 text-center text-muted-foreground">Aucun enregistrement</TD>
          </TR>
        )}
        {!loading &&
          rows.map((row) => (
            <TR key={row.id}>
              {columns.map((c, i) => {
                const content = cell(row, c, statuses, statusKey);
                return (
                  <TD key={c.key} className={`${c.align === 'right' ? 'text-right' : ''} ${i === 0 ? 'font-semibold' : ''}`}>
                    {i === 0 && detailPath ? (
                      <Link to={detailPath(row)} className="hover:underline">{content}</Link>
                    ) : (
                      content
                    )}
                  </TD>
                );
              })}
              {hasActions && (
                <TD>
                  <div className="flex items-center justify-end">
                    {extraActions?.(row)}
                    {qr && detailPath && (
                      <Link to={detailPath(row)} aria-label="QR code" title="QR code" className={ICON_BUTTON}>
                        <QrCode aria-hidden className="size-4" />
                      </Link>
                    )}
                    {onEdit && (
                      <ActionButton label="Modifier" onClick={() => onEdit(row)}>
                        <Pencil aria-hidden className="size-4" />
                      </ActionButton>
                    )}
                    {onDelete && (
                      <ActionButton label="Supprimer" onClick={() => onDelete(row)}>
                        <Trash2 aria-hidden className="size-4" />
                      </ActionButton>
                    )}
                  </div>
                </TD>
              )}
            </TR>
          ))}
      </tbody>
    </Table>
  );
}
