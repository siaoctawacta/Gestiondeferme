import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { Action, ModuleKey } from '../../lib/modules';

/** Options read from a list endpoint (`{items}` shape); every page is loaded. */
export type EndpointOptions = { endpoint: string; valueKey?: string; labelKey?: string };

/** Static `{value,label}` options, or options loaded from an endpoint. */
export type OptionsDef = { value: string; label: string }[] | EndpointOptions;

interface FieldBase {
  /** Property name in the form values and in the request body. */
  name: string;
  label: string;
  required?: boolean;
  /** Only shown (and sent) when creating / when editing (update DTOs reject unknown keys). */
  only?: 'create' | 'update';
  /** Initial value when creating. */
  defaultValue?: unknown;
}

/** One input of the add / edit dialog. */
export type Field =
  | (FieldBase & { type: 'text' | 'date' | 'textarea' })
  | (FieldBase & { type: 'number'; min?: number })
  | (FieldBase & { type: 'password'; minLength?: number })
  | (FieldBase & { type: 'select'; options: OptionsDef })
  /** Checkbox list; the value is the array of selected option values. */
  | (FieldBase & { type: 'multiselect'; options: OptionsDef })
  | (FieldBase & { type: 'checkbox' });

export type Column<T> = {
  /** Row property shown by default, and the `sort` field when `sortable`. */
  key: string;
  /** Header text (rendered uppercase). */
  header: string;
  align?: 'left' | 'right';
  /** Custom cell content; the cell of `statusKey` renders a status pill without it. */
  render?: (row: T) => ReactNode;
  /** Clicking the header toggles `sort=key:asc|desc` (the backend must allow the field). */
  sortable?: boolean;
};

export type StatusDef = {
  value: string;
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
};

export type FormMode = 'create' | 'update';

/** A list filter sent as query parameter `param`; rendered as a select before the table. */
export type FilterDef = {
  param: string;
  /** Label of the "no filter" option, also the select's accessible name. */
  allLabel: string;
  options: OptionsDef;
};

/** An extra per-row button next to the built-in edit and delete ones. */
export type RowAction<T> = {
  key: string;
  /** Accessible label and tooltip. */
  label: string;
  icon: LucideIcon;
  /** `refresh` reloads the page data; `notify` shows a message above the table. A rejection is shown as an error. */
  run: (row: T, helpers: { refresh(): void; notify(message: string): void }) => void | Promise<void>;
  visible?: (row: T) => boolean;
  /** Permission needed on `slug` (default `update`; anything but `read` is also off under "all farms"). */
  permission?: Action;
};

export type FormMap = Record<string, unknown>;

/** Everything `ModulePage` needs to render one module list; plain data only. */
export type ModuleConfig<T extends { id: string }> = {
  /** Module whose permissions gate the page and its buttons. */
  slug: ModuleKey;
  /** Small label above the title (e.g. `Administration`). */
  group: string;
  /** Page title; also the label of the first tab and the dialog title suffix. */
  title: string;
  subtitle: string;
  /** List endpoint (`GET {items,total,page,pageSize}`), also used for create / patch / delete. */
  endpoint: string;
  columns: Column<T>[];
  /** Add / edit form. */
  fields: Field[];
  /** Status values: adds the status filter, per-status tiles and status pills. */
  statuses?: StatusDef[];
  /** Row property holding the status. */
  statusKey?: keyof T;
  /** Key of the per-status totals in the list response (default `statusCounts`). */
  statusCountsKey?: string;
  /** Extra filters after the status one. */
  filters?: FilterDef[];
  /** Row to initial form values (default: the row itself). */
  toForm?: (row: T) => FormMap;
  /** Form values to request body (default: every field of the mode, numbers coerced). */
  toPayload?: (values: FormMap, mode: FormMode) => unknown;
  /** Label used in the delete confirmation (default `row.name`). */
  rowLabel?: (row: T) => string;
  /** First column links here. */
  detailPath?: (row: T) => string;
  /** Shows a QR code button linking to `detailPath`. */
  qr?: boolean;
  actions?: RowAction<T>[];
  /** Further lists under the header, after the first (main) tab; hidden without read permission on their `slug`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tabs?: { key: string; label: string; config: ModuleConfig<any> }[];
  /** False for data outside any farm (farms, users): writes stay possible under "all farms". Default true. */
  farmScoped?: boolean;
};

export interface ListResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  [extra: string]: unknown;
}
