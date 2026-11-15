import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatMoney } from '../../lib/format';
import { useFarmQuery } from '../../lib/query';
import { Table, TH, THead, TR } from '../../components/ui/Table';

/** The `legal` setting: the block printed at the top of every sheet. */
export type Legal = Record<'name' | 'address' | 'nif' | 'rccm', string>;

/**
 * The legal block of the sheets. It comes from the settings and is left out when the user cannot read them; `ready` is
 * true once it is known (loaded, failed, or not readable), so a sheet is never printed before its header arrives.
 */
export function useLegal(enabled = true): { legal: Legal | undefined; ready: boolean } {
  const { can } = useAuth();
  const allowed = enabled && can('parametres', 'read');
  const query = useFarmQuery<Record<string, unknown>>(['settings'], () => api.get<Record<string, unknown>>('/settings'), { enabled: allowed });
  return { legal: query.data?.legal as Legal | undefined, ready: !allowed || !query.isPending };
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

/**
 * Puts a sheet in front of the page when printing, for a document printed from a list or a dialog (a credit note),
 * where the screen behind is not a detail page that hides itself: the app root is hidden in print (see `index.css`)
 * and only the sheet is left.
 */
let overlays = 0;

export function PrintOverlay({ children }: { children: ReactNode }) {
  // Counted: the mark stays while any overlay is mounted (two dialogs, a dialog closing while another opens).
  useEffect(() => {
    overlays += 1;
    document.body.classList.add('print-overlay-active');
    return () => {
      overlays -= 1;
      if (overlays === 0) document.body.classList.remove('print-overlay-active');
    };
  }, []);
  return createPortal(<div className="print-overlay">{children}</div>, document.body);
}
