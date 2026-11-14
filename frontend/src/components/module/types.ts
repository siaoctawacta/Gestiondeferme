import type { ReactNode } from 'react';
import type { ModuleKey } from '../../lib/modules';

export type SelectOptions =
  | { value: string; label: string }[]
  | { endpoint: string; valueKey?: string; labelKey?: string };

interface FieldBase {
  name: string;
  label: string;
  required?: boolean;
  /** Only shown (and sent) when creating / when editing. */
  only?: 'create' | 'update';
  defaultValue?: unknown;
}

export type Field =
  | (FieldBase & { type: 'text' | 'date' | 'textarea' })
  | (FieldBase & { type: 'number'; min?: number })
  | (FieldBase & { type: 'password'; minLength?: number })
  | (FieldBase & { type: 'select'; options: SelectOptions })
  | (FieldBase & { type: 'multiselect'; options: SelectOptions })
  | (FieldBase & { type: 'checkbox' });

export type Column<T> = {
  key: string;
  header: string;
  align?: 'left' | 'right';
  render?: (row: T) => ReactNode;
  sortable?: boolean;
};

export type StatusDef = {
  value: string;
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
};

export type FormMode = 'create' | 'update';

export type ModuleConfig<T extends { id: string }> = {
  /** Also the module whose permissions gate the page. */
  slug: ModuleKey;
  group: string;
  title: string;
  /** Tab label when the page has tabs (defaults to `title`). */
  tabLabel?: string;
  subtitle: string;
  endpoint: string; // e.g. '/buildings'
  columns: Column<T>[];
  fields: Field[];
  statuses?: StatusDef[];
  statusKey?: keyof T;
  /** Tiles: "Total enregistrements" + first 3 statuses, or the total only. */
  statTiles?: 'statuses' | 'totalOnly';
  /** Key of the per-status totals in the list response. */
  statusCountsKey?: string;
  toForm?: (row: T) => Record<string, unknown>;
  /** Form values to request body; the default sends every field of the mode, numbers coerced. */
  toPayload?: (values: Record<string, unknown>, mode: FormMode) => unknown;
  /** Label used in the delete confirmation (defaults to `row.name`). */
  rowLabel?: (row: T) => string;
  detailPath?: (row: T) => string;
  qr?: boolean;
  tabs?: { key: string; label: string; element: ReactNode }[];
  /** Extra per-row buttons, shown before the edit button. */
  rowActions?: (row: T) => ReactNode;
  /** Extra list filter sent as a query parameter, options read from an endpoint. */
  filter?: { param: string; label: string; endpoint: string; valueKey?: string; labelKey?: string };
  /** False for data not owned by a farm (writes stay possible under "all farms"). Default true. */
  farmScoped?: boolean;
};

export interface ListResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  [extra: string]: unknown;
}
