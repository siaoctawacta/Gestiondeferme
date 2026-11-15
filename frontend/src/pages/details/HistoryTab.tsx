import { Card } from '../../components/ui/Card';
import { Table, TD, TR } from '../../components/ui/Table';
import { formatDate } from '../../lib/format';
import { SheetHeads } from '../print/SheetFrame';

/** One step of a document's life: `at` is the ISO timestamp, `by` the user's name, `note` a reason or a detail. */
export interface HistoryStep {
  step: string;
  at: string;
  by: string | null;
  note?: string | null;
}

/** The `Historique` tab of a document detail: step (labelled by `label`), date, author and, with `withNote`, a note column. */
export function HistoryTab({ steps, label, withNote = false }: { steps: HistoryStep[]; label: (step: string) => string; withNote?: boolean }) {
  const columns = withNote ? ['ÉTAPE', 'DATE', 'PAR', 'NOTE'] : ['ÉTAPE', 'DATE', 'PAR'];
  return (
    <Card className="overflow-hidden">
      <Table>
        <SheetHeads labels={columns} />
        <tbody>
          {steps.length === 0 && <TR><TD colSpan={columns.length} className="py-10 text-center text-muted-foreground">Aucun enregistrement</TD></TR>}
          {steps.map((h, i) => (
            <TR key={`${i}-${h.step}`}>
              <TD className="font-semibold">{label(h.step)}</TD>
              <TD>{formatDate(h.at)}</TD>
              <TD>{h.by ?? '—'}</TD>
              {withNote && <TD>{h.note ?? ''}</TD>}
            </TR>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
