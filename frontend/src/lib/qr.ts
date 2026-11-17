/**
 * The QR contract of the API (`GET /qr/:kind/:id`, `POST /qr/labels`), in ONE place. A QR encodes only
 * `{APP_URL}/q/{kind}/{id}`: the label, the farm and the picture below all come from the API's answer.
 */
export type QrKind = 'lot' | 'animal' | 'batiment' | 'article' | 'equipement';

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

/** The in-app QR path (`/q/lot/abc`) of a scanned or pasted value, or `null` when it is not an AgriPilot QR of this site. */
export function qrPathOf(value: string, origin: string = window.location.origin): string | null {
  const text = value.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin || !url.pathname.startsWith('/q/')) return null;
  return `${url.pathname}${url.search}`;
}
