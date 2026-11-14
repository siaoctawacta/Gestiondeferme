import type { ComponentType, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { Action, ModuleKey } from '../../lib/modules';

/**
 * Options read from a list endpoint (`{items}` shape); every page is loaded.
 * `params` are fixed query parameters sent with every page request (e.g. `{ status: 'ACTIF' }`).
 */
export type EndpointOptions = {
  endpoint: string;
  valueKey?: string;
  labelKey?: string;
  params?: Record<string, string>;
};

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
  /** Time of day; the value sent is `HH:mm`. */
  | (FieldBase & { type: 'time' })
  /** `max` is checked on submit; `step` is passed to the input (e.g. `0.1` for decimals). */
  | (FieldBase & { type: 'number'; min?: number; max?: number; step?: number })
  | (FieldBase & { type: 'password'; minLength?: number })
  | (FieldBase & {
      type: 'select';
      options: OptionsDef;
      /**
       * Name of another field of the same form. Its value is sent as the query parameter of the same name
       * when loading this select's endpoint options, and this select is cleared whenever that field changes.
       * Until the parent has a value the select is disabled and reads `Choisir d'abord {parent label}`.
       */
      dependsOn?: string;
    })
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

/** A tab of a module page or of a detail page: another list (`config`) or free content (`element`). */
export type ModuleTab =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { key: string; label: string; config: ModuleConfig<any> }
  | { key: string; label: string; element: ReactNode };

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
  /** First column links here (takes precedence over `detail`). */
  detailPath?: (row: T) => string;
  /**
   * Detail screen of one record. When set, the first column links to `/m/{slug}/{id}` and `ModuleRoute`
   * renders this component there (after the same `read` permission check as the list). The component
   * renders its own `DetailLayout` and shows the 404 card for an unknown id.
   */
  detail?: ComponentType<{ id: string }>;
  /** Per-row switch for the built-in edit button, on top of the `update` permission (default: always). */
  canEdit?: (row: T) => boolean;
  /** Per-row switch for the built-in delete button, on top of the `delete` permission (default: always). */
  canDelete?: (row: T) => boolean;
  /**
   * Custom add / edit form replacing the generated dialog; `row` is absent when adding. Call `onSaved`
   * after a successful write (the list is refetched and the form closed) or `onClose` to cancel.
   * `scope` is the effective scope of the list (see `scope`): the form must merge it into its create payload.
   */
  form?: ComponentType<{ row?: T; scope?: Record<string, string>; onSaved: () => void; onClose: () => void }>;
  /**
   * Fixed query parameters for a list embedded in a detail page (e.g. `{ batchId }`): sent with the list
   * request and the unfiltered-count request, and merged into every create payload after `toPayload` (a custom `form` receives it as a prop and must
   * merge it itself). It wins over a filter or form field of the same name. Never shown as filters.
   */
  scope?: Record<string, string>;
  /** Shows a QR code button linking to `detailPath`. */
  qr?: boolean;
  actions?: RowAction<T>[];
  /**
   * Further tabs under the header, after the first (main) one. A `config` tab is another list, hidden without
   * read permission on its `slug`; an `element` tab is any content and always shown.
   */
  tabs?: ModuleTab[];
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
