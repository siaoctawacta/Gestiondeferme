import { useEffect, useRef, type ReactNode } from 'react';
import { useDocumentSettings, type Legal } from '../../lib/documentSettings';
import { formatMoney } from '../../lib/format';
import { Table, TH, THead, TR } from '../../components/ui/Table';

export type { Legal };

/**
 * The legal block of the sheets, from the document settings every role may read. `ready` is true once it is known
 * (loaded, or failed), so a sheet is never printed before its header arrives; `enabled` false makes no request.
 */
export function useLegal(enabled = true): { legal: Legal | undefined; ready: boolean } {
  const query = useDocumentSettings(enabled);
  return { legal: query.data?.legal, ready: !enabled || !query.isPending };
}

/**
 * THE print trigger of a detail page or dialog: calls `window.print()` once per `request` (any truthy value that
 * changes with each ask: a counter, the object of the sheet), as soon as the sheet is `ready` (legal block loaded).
 * A falsy `request` prints nothing; readiness flipping again never prints a request twice.
 */
export function usePrintWhenReady(ready: boolean, request: unknown): void {
  const printed = useRef<unknown>(null);
  useEffect(() => {
    if (request && ready && printed.current !== request) {
      printed.current = request;
      window.print();
    }
  }, [request, ready]);
}

/** `plain`: no tinted background (the printed sheet rules a border instead). */
export function SheetHeads({ labels, plain = false }: { labels: string[]; plain?: boolean }) {
  return (
    <THead className={plain ? 'bg-transparent! border-b-2 border-foreground [&_th]:text-foreground!' : ''}>
      <TR className="border-b!">{labels.map((h) => <TH key={h}>{h}</TH>)}</TR>
    </THead>
  );
}

/** The ruled table of a printed sheet. */
export function SheetTable({ labels, children }: { labels: string[]; children: ReactNode }) {
  return (
    <Table>
      <SheetHeads plain labels={labels} />
      <tbody>{children}</tbody>
    </Table>
  );
}

/** The grand total of a sheet, as the API computed it. */
export function SheetTotal({ total }: { total: number }) {
  return <p className="text-right text-base font-bold">Total : {formatMoney(total)}</p>;
}

export interface SheetFrameProps {
  /** Title of the sheet, also its accessible name. */
  label: string;
  /** The reference lines under the title (`Référence : …`, `Date : …`). */
  meta: ReactNode;
  /** Heading of the party block (`Client`, `Fournisseur`). */
  partyLabel: string;
  party: { name: string; address?: string | null; phone?: string | null };
  farmName: string | undefined;
  legal: Legal | undefined;
  children: ReactNode;
}

/**
 * THE frame of every printed sheet (bon de commande, devis, facture, avoir, reçu, bon de livraison): legal block of the
 * farm on the left, title and references on the right, the party, then the body. Shown only when printing
 * (`print:block`), the screen layout being hidden then.
 */
export function SheetFrame({ label, meta, partyLabel, party, farmName, legal, children }: SheetFrameProps) {
  return (
    <section aria-label={label} className="hidden space-y-6 text-sm print:block">
      <header className="flex items-start justify-between gap-6 border-b border-border pb-4">
        <div>
          <p className="text-lg font-bold">{legal?.name || farmName}</p>
          {legal?.address && <p>{legal.address}</p>}
          {(legal?.nif || legal?.rccm) && (
            <p>{[legal.nif && `NIF : ${legal.nif}`, legal.rccm && `RCCM : ${legal.rccm}`].filter(Boolean).join(' · ')}</p>
          )}
        </div>
        <div className="text-right">
          <h2 className="text-2xl font-bold">{label}</h2>
          {meta}
        </div>
      </header>
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{partyLabel}</p>
        <span className="block font-semibold">{party.name}</span>
        {party.address && <p>{party.address}</p>}
        {party.phone && <p>{party.phone}</p>}
      </div>
      {children}
    </section>
  );
}
