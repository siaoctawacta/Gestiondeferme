/**
 * The QR contract of the API (`GET /qr/:kind/:id`, `POST /qr/labels`), in ONE place. A QR encodes only
 * `{APP_URL}/q/{kind}/{id}`: the label, the farm and the picture below all come from the API's answer.
 */
export const QR_KINDS = ['lot', 'animal', 'batiment', 'article', 'equipement'] as const;
export type QrKind = (typeof QR_KINDS)[number];

export const isQrKind = (v: string | undefined): v is QrKind => QR_KINDS.some((k) => k === v);

/** `GET /qr/:kind/:id` with the id made safe for a path. */
export const qrEndpoint = (kind: QrKind, id: string): string => `/qr/${kind}/${encodeURIComponent(id)}`;

/** What the API resolves a `kind/id` to, and what a label is drawn from. */
export interface QrTarget {
  kind: QrKind;
  id: string;
  /** The record's farm; `null` for an article (an organisation catalogue). */
  farmId: string | null;
  farmName: string | null;
  /** In-app page of the record (`/m/lots/…`). */
  path: string;
  /** The address the QR encodes (`{APP_URL}/q/{kind}/{id}`). */
  url: string;
  label: string;
  sublabel: string;
  /** The QR as SVG text; shown as an image, never injected into the page. */
  svg: string;
}

export interface QrLabelsResponse {
  labels: QrTarget[];
}

/** Most labels one `POST /qr/labels` accepts (and one sheet of labels holds). */
export const QR_LABEL_MAX = 60;

/** The SVG text as an image source: the browser draws it as a picture, so nothing in it can run. */
export const svgDataUrl = (svg: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/**
 * The in-app QR path (`/q/lot/abc`) of a scanned or pasted value, or `null` when it is not a QR link. The origin does not
 * matter (the label may carry the API host or another deployment's address): only the path `/q/{kind}/{id}` with a known
 * kind is kept, and the app opens it on its own origin, where the API checks the access.
 */
export function qrPathOf(value: string, origin: string = window.location.origin): string | null {
  const text = value.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text, origin);
  } catch {
    return null;
  }
  const [empty, q, kind, id, ...rest] = url.pathname.split('/');
  if (empty !== '' || q !== 'q' || !isQrKind(kind) || !id || rest.length > 0) return null;
  return `/q/${kind}/${id}`;
}
