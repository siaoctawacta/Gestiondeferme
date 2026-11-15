import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router';
import { ChevronDown, ChevronUp, Pencil, QrCode, Trash2 } from 'lucide-react';
import { Table, TD, TH, THead, TR } from '../ui/Table';
import { Pill } from '../ui/Pill';
import type { Column, RowGate, StatusDef } from './types';

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

/** A row button already filtered by permission and bound to its handler. */
export interface TableAction<T> {
  key: string;
  label: string;
  icon: LucideIcon;
  visible?: (row: T) => boolean;
  run: (row: T) => void;
}

export interface DataTableProps<T extends { id: string }> {
  columns: Column<T>[];
  rows: T[];
  loading: boolean;
  statuses?: StatusDef[];
  statusKey?: keyof T;
  /** Only needed when a column is `sortable`. */
  sort?: SortState | null;
  onSort?: (key: string) => void;
  /** `undefined` for a row without a page: its first cell is plain text. */
  detailPath?: (row: T) => string | undefined;
  qr?: boolean;
  actions?: TableAction<T>[];
  /** Shown when there are no rows (default `Aucun enregistrement`). */
  emptyText?: string;
  onEdit?: (row: T) => void;
  onDelete?: (row: T) => void;
  /** Per-row switches for the edit / delete buttons (default: shown on every row): `false` hides, a string disables with that tooltip. */
  canEdit?: (row: T) => RowGate;
  canDelete?: (row: T) => RowGate;
}

const ICON_BUTTON =
  'inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring';

/**
 * An icon button. With `disabledReason` it stays visible but muted: `aria-disabled`, the reason as tooltip and no
 * action on click. It is not the `disabled` attribute, so it keeps its place in the tab order and the tooltip
 * stays reachable.
 */
export const ActionButton = ({
  label, onClick, children, disabledReason,
}: { label: string; onClick: () => void; children: ReactNode; disabledReason?: string }) => (
  <button
    type="button"
    aria-label={label}
    aria-disabled={disabledReason ? true : undefined}
    title={disabledReason ?? label}
    onClick={disabledReason ? undefined : onClick}
    className={disabledReason ? `${ICON_BUTTON} cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground` : ICON_BUTTON}
  >
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

const gate = <T,>(fn: ((row: T) => RowGate) | undefined, row: T): RowGate => fn?.(row) ?? true;
const reason = (g: RowGate): string | undefined => (typeof g === 'string' ? g : undefined);

export function DataTable<T extends { id: string }>({
  columns, rows, loading, statuses, statusKey, sort, onSort, detailPath, qr, actions, emptyText = 'Aucun enregistrement', onEdit, onDelete, canEdit, canDelete,
}: DataTableProps<T>) {
  const hasActions = Boolean(qr || (actions && actions.length > 0) || onEdit || onDelete);
  const span = columns.length + (hasActions ? 1 : 0);

  return (
    <Table>
      <THead>
        {/* The reference rules a line under the header too. */}
        <TR className="border-b!">
          {columns.map((c) => {
            const active = sort?.key === c.key;
            return (
              <TH
                key={c.key}
                className={c.align === 'right' ? 'text-right' : ''}
                aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
              >
                {c.sortable ? (
                  <button type="button" onClick={() => onSort?.(c.key)} className="inline-flex items-center gap-1 uppercase tracking-wider">
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
            <TD colSpan={span} className="py-10 text-center text-muted-foreground">{emptyText}</TD>
          </TR>
        )}
        {!loading &&
          rows.map((row) => (
            <TR key={row.id}>
              {columns.map((c, i) => {
                const content = cell(row, c, statuses, statusKey);
                return (
                  <TD key={c.key} className={`${c.align === 'right' ? 'text-right' : ''} ${i === 0 ? 'font-semibold' : ''}`}>
                    {i === 0 && detailPath?.(row) ? (
                      <Link to={detailPath(row)!} className="hover:underline">{content}</Link>
                    ) : (
                      content
                    )}
                  </TD>
                );
              })}
              {hasActions && (
                <TD>
                  <div className="flex min-h-8 items-center justify-end">
                    {actions?.filter((a) => a.visible?.(row) ?? true).map((a) => (
                      <ActionButton key={a.key} label={a.label} onClick={() => a.run(row)}>
                        <a.icon aria-hidden className="size-4" />
                      </ActionButton>
                    ))}
                    {qr && detailPath?.(row) && (
                      <Link to={detailPath(row)!} aria-label="QR code" title="QR code" className={ICON_BUTTON}>
                        <QrCode aria-hidden className="size-4" />
                      </Link>
                    )}
                    {onEdit && gate(canEdit, row) !== false && (
                      <ActionButton label="Modifier" onClick={() => onEdit(row)} disabledReason={reason(gate(canEdit, row))}>
                        <Pencil aria-hidden className="size-4" />
                      </ActionButton>
                    )}
                    {onDelete && gate(canDelete, row) !== false && (
                      <ActionButton label="Supprimer" onClick={() => onDelete(row)} disabledReason={reason(gate(canDelete, row))}>
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
