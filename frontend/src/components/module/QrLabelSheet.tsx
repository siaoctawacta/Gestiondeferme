import type { CSSProperties } from 'react';
import { api } from '../../lib/api';
import { QR_LABEL_MAX, svgDataUrl, type QrKind, type QrLabelsResponse, type QrTarget } from '../../lib/qr';
import { useFarmQuery } from '../../lib/query';
import { PrintOverlay } from '../ui/PrintOverlay';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Dialog, DialogActions } from '../ui/Dialog';
import { errorMessage } from './errorMessage';
import { LoadingBlock } from './LoadingBlock';

/** A4 sheet of 3 × 8 labels of 63,5 × 33,9 mm (the usual adhesive sheet), QR of 25 mm. */
const COLUMNS = 3;
const ROWS = 8;
const PER_SHEET = COLUMNS * ROWS;
const LABEL_W = 63.5;
const LABEL_H = 33.9;
const QR_SIZE = 25;
/** Margins that centre the grid on A4. */
const MARGIN_X = (210 - COLUMNS * LABEL_W) / 2;
const MARGIN_Y = (297 - ROWS * LABEL_H) / 2;

const GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: `repeat(${COLUMNS}, ${LABEL_W}mm)`,
  gridAutoRows: `${LABEL_H}mm`,
};

/** One adhesive label: the QR, the label in bold, the sub-label and the farm. Built only from the API's answer. */
export function QrLabel({ target, bordered = false }: { target: QrTarget; bordered?: boolean }) {
  return (
    <li
      data-testid="qr-label"
      style={{ width: `${LABEL_W}mm`, height: `${LABEL_H}mm` }}
      className={`flex items-center gap-[2mm] overflow-hidden p-[2mm] text-[8pt] leading-tight text-black ${bordered ? 'border border-dashed border-border' : ''}`}
    >
      <img src={svgDataUrl(target.svg)} alt={`QR code ${target.label}`} style={{ width: `${QR_SIZE}mm`, height: `${QR_SIZE}mm` }} className="shrink-0" />
      <div className="min-w-0">
        <p className="break-words text-[10pt] font-bold">{target.label}</p>
        <p className="break-words">{target.sublabel}</p>
        {target.farmName && <p className="mt-[1mm] break-words text-[7pt]">{target.farmName}</p>}
      </div>
    </li>
  );
}

/**
 * The printed sheets: one A4 page per 24 labels, only visible when printing (`PrintOverlay` hides the app). The page
 * has no margin of its own (`@page qr-labels`, see `index.css`); the grid is centred by padding so that every page,
 * not only the first, keeps the labels on the adhesive cells.
 */
export function QrLabelPrint({ labels }: { labels: QrTarget[] }) {
  const sheets: QrTarget[][] = [];
  for (let i = 0; i < labels.length; i += PER_SHEET) sheets.push(labels.slice(i, i + PER_SHEET));
  return (
    <PrintOverlay>
      <div className="qr-sheet">
        {sheets.map((sheet, i) => (
          <section
            key={i}
            aria-label={`Planche ${i + 1}`}
            style={{ width: '210mm', height: '296.5mm', overflow: 'hidden', padding: `${MARGIN_Y}mm ${MARGIN_X}mm`, breakAfter: i < sheets.length - 1 ? 'page' : undefined }}
            className="box-border"
          >
            <ul style={GRID}>
              {sheet.map((t) => <QrLabel key={`${t.kind}:${t.id}`} target={t} />)}
            </ul>
          </section>
        ))}
      </div>
    </PrintOverlay>
  );
}

export interface LabelRow {
  id: string;
  kind: QrKind;
}

/**
 * The labels of the rows on screen (the first `QR_LABEL_MAX` of them: the API's limit per call), asked of the API
 * (`POST /qr/labels`, one call per kind: the herd of lots and animals mixes two kinds and asks twice) and returned in the
 * rows' order. A row the API leaves out (missing or not readable) does not show.
 */
export function useQrLabels(rows: LabelRow[]) {
  const wanted = rows.slice(0, QR_LABEL_MAX);
  return useFarmQuery<QrTarget[]>(['/qr/labels', wanted.map((r) => `${r.kind}:${r.id}`)], async () => {
    const kinds = [...new Set(wanted.map((r) => r.kind))];
    const answers = await Promise.all(
      kinds.map((kind) =>
        api.post<QrLabelsResponse>('/qr/labels', { kind, ids: wanted.filter((r) => r.kind === kind).map((r) => r.id) }),
      ),
    );
    const byKey = new Map(answers.flatMap((a) => a.labels).map((t) => [`${t.kind}:${t.id}`, t]));
    return wanted.map((r) => byKey.get(`${r.kind}:${r.id}`)).filter((t): t is QrTarget => t !== undefined);
  });
}

/** `Étiquettes QR — {module}`: a preview of the labels of the visible page, and the print of the A4 sheets. */
export function QrLabelSheet({ title, rows, onClose }: { title: string; rows: LabelRow[]; onClose: () => void }) {
  const query = useQrLabels(rows);
  const labels = query.data;
  return (
    <>
      <Dialog open onClose={onClose} title={`Étiquettes QR — ${title}`} wide>
        {query.isError ? (
          <Alert>{errorMessage(query.error)}</Alert>
        ) : !labels ? (
          <LoadingBlock className="h-24" />
        ) : (
          <div className="overflow-x-auto">
            <p className="mb-3 text-sm text-muted-foreground">
              {labels.length} {labels.length > 1 ? 'étiquettes' : 'étiquette'}, planche A4 de 3 × 8 étiquettes de 63,5 × 33,9 mm.
            </p>
            <ul style={{ ...GRID, width: `${COLUMNS * LABEL_W}mm` }}>
              {labels.map((t) => <QrLabel key={`${t.kind}:${t.id}`} target={t} bordered />)}
            </ul>
          </div>
        )}
        <DialogActions>
          <Button variant="outline" onClick={onClose}>Fermer</Button>
          {labels && labels.length > 0 && <Button onClick={() => window.print()}>Imprimer</Button>}
        </DialogActions>
      </Dialog>
      {labels && labels.length > 0 && <QrLabelPrint labels={labels} />}
    </>
  );
}
