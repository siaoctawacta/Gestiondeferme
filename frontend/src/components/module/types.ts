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
  /**
   * Initial value when creating. A function is evaluated each time the dialog opens, so a date default
   * (`todayIso`) is never frozen when the module loads.
   */
  defaultValue?: unknown | (() => unknown);
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

/** Fields shared by every extra per-row button. */
type RowActionBase<T> = {
  key: string;
  /** Accessible label and tooltip. */
  label: string;
  icon: LucideIcon;
  visible?: (row: T) => boolean;
  /** Permission needed on `slug` (default `update`; anything but `read` is also off under "all farms"). */
  permission?: Action;
};

/**
 * An extra per-row button next to the built-in edit and delete ones. It has exactly one of:
 * - `run`: `refresh` reloads the page data; `notify` shows a message above the table. A rejection is shown as an error;
 * - `dialog`: a dialog the page opens for the row. It calls `onDone` after a successful write (the dialog is
 *   closed and the list refetched) or `onClose` to cancel. Lets a config-only module (no page component of its
 *   own) open dialogs.
 */
export type RowAction<T> = RowActionBase<T> &
  (
    | {
        run: (row: T, helpers: { refresh(): void; notify(message: string): void }) => void | Promise<void>;
        dialog?: never;
      }
    | { dialog: ComponentType<{ row: T; onClose: () => void; onDone: () => void }>; run?: never }
  );

export type FormMap = Record<string, unknown>;

/** A tab of a module page or of a detail page: another list (`config`) or free content (`element`). */
export type ModuleTab =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { key: string; label: string; config: ModuleConfig<any> }
  | { key: string; label: string; element: ReactNode };

/** What a per-row edit / delete switch answers: `true` shows the button, `false` hides it, a string shows it disabled with that reason as tooltip. */
export type RowGate = boolean | string;

/** The add / edit form of a module: generated from `fields`, or a custom component. */
export type CustomForm<T> = ComponentType<{ row?: T; scope?: Record<string, string>; onSaved: () => void; onClose: () => void }>;

/** Everything `ModulePage` needs to render one module list; plain data only. */
export type ModuleConfig<T extends { id: string }> = ModuleConfigBase<T> &
  (
    | {
        /** Add / edit form generated from these inputs. */
        fields: Field[];
        form?: never;
      }
    | {
        /**
         * Custom add / edit form replacing the generated dialog; `row` is absent when adding. Call `onSaved`
         * after a successful write (the list is refetched and the form closed) or `onClose` to cancel.
         * `scope` is the effective scope of the list (see `scope`): the form must merge it into its create payload.
         */
        form: CustomForm<T>;
        fields?: never;
      }
  );

type ModuleConfigBase<T extends { id: string }> = {
  /** Module whose permissions gate the page and its buttons. */
  slug: ModuleKey;
  /** Small label above the title (e.g. `Administration`). */
  group: string;
  /** Page title; also the label of the first tab (unless `tabLabel`) and the dialog title suffix. */
  title: string;
  /**
   * Label of the first tab, to use when it differs from the page title (the page is `Alimentation & eau` but its
   * first tab, next to `Aliments` and `Formules`, is `Distributions`). Default: `title`.
   */
  tabLabel?: string;
  subtitle: string;
  /** List endpoint (`GET {items,total,page,pageSize}`), also used for create / patch / delete. */
  endpoint: string;
  columns: Column<T>[];
  /** Status values: adds the status filter, per-status tiles and status pills. */
  statuses?: StatusDef[];
  /** Row property holding the status. */
  statusKey?: keyof T;
  /** Extra filters after the status one. */
  filters?: FilterDef[];
  /** Row to initial form values: the stored values an edit is compared with (default: the row itself). */
  toForm?: (row: T) => FormMap;
  /**
   * Form values to request body (default: every field of the mode, numbers coerced). Empty values (`''`,
   * `undefined`) are left out when creating. When editing, only the keys whose value differs from the one
   * `toPayload` gives for `toForm(row)` are sent, a cleared one as `null`, and an edit that changes nothing sends
   * no request.
   */
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
  /**
   * Per-row switch for the built-in edit button, on top of the `update` permission (default: always). `false`
   * hides the button; a string keeps the icon visible but disabled, with the string as its tooltip (the reason
   * the row cannot be edited, e.g. `Lot clôturé`).
   */
  canEdit?: (row: T) => RowGate;
  /** `DELETE` target of the built-in delete button when it is not `{endpoint}/{id}` (a list that merges several record kinds). */
  deletePath?: (row: T) => string;
  /** Per-row switch for the built-in delete button, on top of the `delete` permission (default: always); same answers as `canEdit`. */
  canDelete?: (row: T) => RowGate;
  /**
   * Permission that shows the `Ajouter` button (default `create`). A master-data list (lots, herd, incubations,
   * feeds, formulas) whose API routes need `update` sets `update`; daily entries keep `create`.
   */
  createPermission?: Action;
  /**
   * Permission that shows the built-in edit button (default `update`), on top of `canEdit`. A list of daily
   * entries (movements, weighings, heats, egg records, distributions) whose API routes accept `create` for
   * corrections sets `create`, so the agent who may enter a record also sees how to correct it. Master-data
   * lists keep the default. Never shown under "all farms", whatever the permission.
   */
  editPermission?: Action;
  /** Permission that shows the built-in delete button (default `delete`), on top of `canDelete`; same use as `editPermission`. */
  deletePermission?: Action;
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
  /** False when the endpoint has no export route: the Exporter control is not rendered. Default true. */
  exportable?: boolean;
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
