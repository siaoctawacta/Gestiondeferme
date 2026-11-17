import type { ComponentType, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { Action, ModuleKey } from '../../lib/modules';
import type { QrKind } from '../../lib/qr';

/**
 * Options read from a list endpoint (`{items}` shape); every page is loaded.
 * `params` are fixed query parameters sent with every page request (e.g. `{ status: 'ACTIF' }`).
 *
 * Two extras for a select that depends on another field (`dependsOn`):
 * - `endpoint` may hold `{field}`, replaced by the (URL-encoded) value of that parent field
 *   (`/stock/{stockItemId}`); the parent value is then part of the path and not sent as a query parameter;
 * - `select` maps the response of a single `GET` (not a `{items}` page list, nothing is paged) to the options,
 *   for an endpoint whose answer is a record holding the choices (a stock item and its batches); `ctx.userId` is the
 *   signed-in user (the employee linked to him, among the options of `/employees/options`).
 * Until the parent has a value the select is disabled and no request is made; changing the parent clears it.
 */
export type EndpointOptions = {
  endpoint: string;
  valueKey?: string;
  labelKey?: string;
  params?: Record<string, string>;
  select?: (data: unknown, ctx: { userId: string | null }) => OptionItem[];
};

/**
 * One choice of a select. `disabled` shows it greyed out and not pickable (a lot under withdrawal, with its reason in
 * the label); `data` is whatever the loader keeps of the record, handed to a cell's `onPick`.
 */
export type OptionItem = { value: string; label: string; disabled?: boolean; data?: unknown };

/**
 * Static `{value,label}` options, or options loaded from an endpoint. A select whose current value is not among them
 * (an incident on a lot since closed, an article since deactivated) keeps it as the disabled option `Valeur actuelle`
 * (`Valeur conservée` when the options cannot be read, e.g. without the permission of `OptionsPermission`) and resends it
 * unchanged, instead of falling back to `Sélectionner…`.
 */
export type OptionsDef = OptionItem[] | EndpointOptions;

/**
 * The permission a select's endpoint options need (the options come from another module's route, e.g. stock
 * articles for a health form). Without it no request is made and the select is shown disabled, keeping the stored
 * value, which the form resends unchanged.
 */
export type OptionsPermission = { module: ModuleKey; action: Action };

interface FieldBase {
  /** Property name in the form values and in the request body. */
  name: string;
  label: string;
  required?: boolean;
  /** Only shown (and sent) when creating / when editing (update DTOs reject unknown keys). */
  only?: 'create' | 'update';
  /**
   * Helper text shown under the control and linked to it (`aria-describedby`), in full as the caller words it
   * (`Par défaut : 2026-11-30`). A function sees the form's current values and may answer `undefined` for no hint.
   * Shown for the single-control fields (text, date, time, number, password, select, textarea); NOT rendered for
   * `checkbox`, `multiselect`, `segmented` and `lines` fields, nor for the cells of a `lines` grid.
   */
  hint?: string | ((values: Record<string, unknown>) => string | undefined);
  /**
   * Initial value when creating. A function is evaluated each time the dialog opens, so a date default
   * (`todayIso`) is never frozen when the module loads.
   */
  defaultValue?: unknown | (() => unknown);
}

/**
 * A row of a `lines` field as edited: every cell is a string (the payload coerces numbers). Keys of the initial rows that are
 * no column are kept untouched (as strings) and never sent: a `fixed` grid's `toPayload` reads them.
 */
export type LineRow = Record<string, string>;

/**
 * A cell of a `lines` row: the input of a text, date, number or select field, rendered by the same control as the
 * form's own inputs. A cell has no `only`, `defaultValue` or `dependsOn`.
 */
export type CellField =
  | (CellBase & { type: 'text' | 'date' })
  | (CellBase & {
      type: 'number';
      min?: number;
      max?: number;
      /** A step may depend on the row (a whole quantity for a lot, hundredths for a service). */
      step?: number | ((row: LineRow) => number);
      /** Whole numbers only (checked on submit), always or for the rows the function says. */
      integer?: boolean | ((row: LineRow) => boolean);
      /** The message of a refused decimal, shown as `Ligne n : {message}` (default: `le champ « {label} » doit être un nombre entier`). */
      integerMessage?: string;
    })
  | (CellBase & {
      type: 'select';
      /**
       * The choices, or a function of the row (see `dependsOnCell`): `null` means this row has none: the cell shows
       * `—`, is disabled, is not required and is left out of the payload.
       */
      options: OptionsDef | ((row: LineRow) => OptionsDef | null);
      /** An option already chosen in another row of the grid is not offered again. */
      unique?: boolean;
      /** See the select field: the endpoint options need this permission; without it `required` does not apply to the column. */
      optionsPermission?: OptionsPermission;
      /**
       * Name of another cell of the SAME row that this cell's options depend on (`options` is then a function of the
       * row). The same mechanism as a select's `dependsOn` (`useDependentValues`): this cell is cleared whenever that
       * cell changes in that row, other rows are untouched, a stored value nobody touched stays until then, and a
       * value chosen under an earlier value of the parent never comes back. Options from an endpoint are fetched
       * once per distinct path (the query is cached), however many rows ask for it.
       */
      dependsOnCell?: string;
      /**
       * The label of the row's current value when the options do not offer it any more (a lot sold out since): shown as
       * a disabled option instead of `Valeur actuelle`. A value picked in this grid remembers its own label.
       */
      currentLabel?: (row: LineRow) => string | undefined;
      /**
       * Called when the user picks an option in this cell: the cells it returns are set in the same row (the
       * designation and unit of a sellable). They count as chosen after the row's current parent value. A cell the
       * user filled in is never overwritten: only an empty one, or one still holding the previous pick's prefill, is set;
       * and when this cell is cleared by its parent, the prefills of its pick that the user left alone are cleared with it.
       */
      onPick?: (option: OptionItem, row: LineRow) => Partial<LineRow>;
    });

interface CellBase {
  /** Key of the cell in the row object (and in the request body). */
  name: string;
  /** Column header; the cell's accessible name is `{label} ligne {n}`. */
  label: string;
  required?: boolean;
  /** The cell shows its value as text (no input); the value stays in the row and in the payload. */
  readOnly?: boolean;
  /**
   * A column computed from the row (a gap, a total): shows this instead of an input, is not validated and is not
   * part of the payload.
   */
  computed?: (row: LineRow) => ReactNode;
}

/**
 * One input of the add / edit dialog. A field that is not shown (left out by a `fields` function, or `only` for
 * the other mode) is absent from the values given to `validate` and `toPayload` and is never sent, whatever the
 * user entered before it was hidden.
 */
export type Field =
  | (FieldBase & { type: 'text' | 'date' | 'textarea' })
  /**
   * A file chosen from the device (a proof photo): the value is the `File`, or `''` for none (then left out of the
   * payload); the request that sends it (`FormData`) is the caller's. `accept` narrows the picker.
   */
  | (FieldBase & { type: 'file'; accept?: string })
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
       * A dependent value never goes stale: it is cleared every time the parent's value changes (even while the
       * dependent is hidden by a `fields` function), and a value chosen under another `dependsOn` field does not
       * carry over to this one.
       */
      dependsOn?: string;
      /** Label of the current value when the options do not offer it (shown disabled instead of `Valeur actuelle`). */
      currentLabel?: string;
      /** The endpoint options need this permission (see `OptionsPermission`); without it `required` does not apply. */
      optionsPermission?: OptionsPermission;
    })
  /**
   * A choice between a few exclusive options shown as a pill-shaped radio group (a type, a kind of target); the
   * value is the chosen option's value, `defaultValue` the one checked first. Options are static.
   */
  | (FieldBase & { type: 'segmented'; options: { value: string; label: string }[] })
  /** Checkbox list; the value is the array of selected option values. */
  | (FieldBase & { type: 'multiselect'; options: OptionsDef })
  | (FieldBase & { type: 'checkbox' })
  /**
   * Line items (ingredients of a formula, products of an order): a grid of rows, one `columns` cell each, with add
   * and remove buttons. The value is the array of row objects; in the request body numbers are numbers and empty
   * cells are left out. An edit compares the array as a whole (deep, order-sensitive): unchanged, it is not sent.
   * Cells are validated on submit and their messages shown under the grid.
   */
  | (FieldBase & {
      type: 'lines';
      columns: CellField[];
      /** Fewest rows: the remove button is disabled at that count and a smaller array is refused (`Ajoutez au moins une ligne`). */
      minRows?: number;
      /** Label of the add button (default `Ajouter une ligne`). */
      addLabel?: string;
      /**
       * The rows are the given ones (`initial` / `defaultValue`), in that order: no add or remove button. For a grid
       * over a fixed list (the lines of an order being received); a `toPayload` may then pair rows with the source by index.
       */
      fixed?: boolean;
      /** Shown under the grid with the rows as edited (a running total, a derived cost...). */
      footer?: (rows: LineRow[]) => ReactNode;
    });

/**
 * What a `lines` grid reports with its new rows, so the form engine can follow cells that depend on another cell of the
 * row: `cells` of row `row` were set by the user (or by an `onPick`), or row `remove` was removed.
 */
export type LinesEdit = { row: number; cells: string[] } | { remove: number };

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
  /** The column is shown only when this answers true (a salary column behind a permission); default: always. */
  visible?: (ctx: { can: (module: ModuleKey, action: Action) => boolean }) => boolean;
};

export type StatusDef = {
  value: string;
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
};

export type FormMode = 'create' | 'update';

/**
 * A list filter sent as query parameter `param`; rendered before the table as a select, or as a date input
 * (`type: 'date'`, a bound of a period: `from` / `to`; empty means no bound).
 */
export type FilterDef =
  | {
      param: string;
      /** Label of the "no filter" option, also the select's accessible name. */
      allLabel: string;
      type?: 'select';
      options: OptionsDef;
      /** The select is not rendered while it has no option (`Mes tâches`, for a user who is no employee). */
      hideWhenEmpty?: boolean;
    }
  | {
      param: string;
      /** Accessible name of the date input (`Du`, `Au`). */
      allLabel: string;
      type: 'date';
      options?: never;
      hideWhenEmpty?: never;
    };

/** Fields shared by every extra per-row button. */
type RowActionBase<T> = {
  key: string;
  /** Accessible label and tooltip. */
  label: string;
  icon: LucideIcon;
  /**
   * Whether the button is offered for this row (default: always), on top of `permission`. `can` is the user's
   * permission check, for a row whose button depends on a module other than `slug` (a plan of one species).
   */
  visible?: (row: T, ctx: { can: (module: ModuleKey, action: Action) => boolean }) => boolean;
  /** Permission needed on `slug` (default `update`; anything but `read` is also off under "all farms"). */
  permission?: Action;
  /** For a module whose data is not farm-scoped: the action still needs one farm (a lot, a stock), so it is hidden under "all farms". */
  needsFarm?: boolean;
};

/**
 * An extra per-row button next to the built-in edit and delete ones. It has exactly one of:
 * - `run`: `refresh` reloads the page data; `notify` shows a message above the table. A rejection is shown as an error;
 * - `dialog`: a dialog the page opens for the row. It calls `onDone` after a successful write (the dialog is
 *   closed and the list refetched) or `onClose` to cancel. Lets a config-only module (no page component of its
 *   own) open dialogs.
 *
 * A workflow action shared with a detail page is defined once as a `SharedActionDef` (`rowActions.ts`) and turned into a
 * `RowAction` by `toRowActions` (`Dialog` becomes `dialog`).
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

/**
 * THE gating model of a list's write controls (the only place it is described), from the outermost switch inward:
 * 1. The user's permission on `slug`, and the farm: `createPermission` (`Ajouter`), `editPermission` / `deletePermission` (row icons),
 *    a row action's `permission`. Under "all farms" nothing writes (but a `farmScoped: false` list).
 * 2. `ModuleConfig.noCreate`: the records are made elsewhere, so no `Ajouter`; the row icons stay.
 * 3. `ModuleList`'s `readOnly` (a page that embeds the list in a state where nothing may change):
 *    - `true`: no `Ajouter` and no write icon at all, but what `whenReadOnly` lets through (row by row);
 *    - a reason string (`Lot clôturé`, `Animal sorti du cheptel`): no `Ajouter`, every row icon stays visible but disabled
 *      with the reason as tooltip (the built-in edit and delete, and the row actions), but what `whenReadOnly` lets through.
 * 4. Per row, `canEdit` / `canDelete`: `false` hides the icon (a final record), a string disables it with that reason,
 *    `true` leaves it usable. A list's `readOnly` reason wins over a row's own string; a row's `false` stays hidden.
 * A row action is further limited by its `visible`.
 *
 * Everything an embedded list needs to say about "this record is closed" goes through `readOnly`; there is no other prop.
 */

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
  /**
   * Opens the generated add / edit dialog at `max-w-3xl` instead of `max-w-lg`: needed by a `lines` field of more than
   * three columns, which would otherwise scroll sideways. Same option as `ActionDialog.wide`.
   */
  wide?: boolean;
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
  /**
   * First column links here (takes precedence over `detail`). `undefined` leaves the cell as plain text: a row whose
   * page the user may not read (`can` is the user's permission check).
   */
  detailPath?: (row: T, ctx: { can: (module: ModuleKey, action: Action) => boolean }) => string | undefined;
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
   * No `Ajouter` button, for a list whose records are made elsewhere (credit notes are made from an invoice). The rows
   * keep their icons: `canEdit` / `canDelete` answering `false` hide those of a final record. `fields: []` goes with it
   * when there is no generated form. (See the gating model above.)
   */
  noCreate?: boolean;
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
  /**
   * The kind of record a row's QR code labels (`'lot'`, a function of the row for a list that mixes kinds; `null` for a row
   * without one). It shows the `QR code` row icon, which opens the QR dialog of `{kind, row.id}` (`GET /qr/:kind/:id`), and
   * adds `Étiquettes QR` to the export menu: the sheet of labels of the rows on screen (`POST /qr/labels`).
   */
  qr?: QrKind | ((row: T) => QrKind | null);
  actions?: RowAction<T>[];
  /**
   * What an embedded list that is `readOnly` (a closed lot, an exited animal) still lets through, decided row by row:
   * the row actions by `key` (they must also be `visible` and permitted) and the delete icon (still behind
   * `deletePermission` and `canDelete`). Without it a `readOnly` list has no usable write control (hidden, or disabled
   * with its reason). Add, edit and every other action stay out.
   */
  whenReadOnly?: {
    actions?: Record<string, (row: T) => boolean>;
    canDelete?: (row: T) => boolean;
  };
  /**
   * Further tabs under the header, after the first (main) one. A `config` tab is another list, hidden without
   * read permission on its `slug`; an `element` tab is any content and always shown.
   */
  tabs?: ModuleTab[];
  /**
   * Filters (`params`, date or select filters of `filters`) that the page and ALL its tabs share: one state, kept when
   * switching tabs, read by the `config` tabs' lists and by `element` tabs through `useSharedFilters()`. `defaults` gives
   * their first values (a period of the month to date, shown in the inputs); `validate` answers a French message for
   * values that must not be sent (the lists and the tabs then query nothing and the page shows the message).
   */
  sharedFilters?: {
    params: string[];
    defaults: () => Record<string, string>;
    validate?: (values: Record<string, string>) => string | null;
  };
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
