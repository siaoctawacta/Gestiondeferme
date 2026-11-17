import { toMoney } from '../common/money';
import type { Prisma } from '../generated/prisma/client';
import type {
  Activity,
  FinanceCategory,
  SaleLineKind,
} from '../generated/prisma/enums';
import { lineActivity, lineCategory } from './sale-lines';

/** The relations a sale line view needs to name its source and derive its activity. */
export const lineInclude = {
  batch: { select: { code: true, species: true } },
  animal: { select: { tag: true } },
  stockItem: { select: { name: true } },
} satisfies Prisma.QuoteLineInclude;

export interface SaleLineView {
  id: string;
  position: number;
  kind: SaleLineKind;
  batchId: string | null;
  animalId: string | null;
  stockItemId: string | null;
  /** The lot code, animal tag or article name; null for a service. */
  sourceLabel: string | null;
  designation: string;
  unit: string | null;
  eggsPerUnit: number | null;
  quantity: number;
  unitPrice: number;
  amount: number;
  weightKg: number | null;
  activity: Activity;
  category: FinanceCategory;
}

type LineWithSource = Omit<
  Prisma.QuoteLineGetPayload<{ include: typeof lineInclude }>,
  'quoteId'
>;

export function lineView(l: LineWithSource): SaleLineView {
  return {
    id: l.id,
    position: l.position,
    kind: l.kind,
    batchId: l.batchId,
    animalId: l.animalId,
    stockItemId: l.stockItemId,
    sourceLabel: l.batch?.code ?? l.animal?.tag ?? l.stockItem?.name ?? null,
    designation: l.designation,
    unit: l.unit,
    eggsPerUnit: l.eggsPerUnit,
    quantity: l.quantity.toNumber(),
    unitPrice: toMoney(l.unitPrice),
    amount: toMoney(l.amount),
    weightKg: l.weightKg?.toNumber() ?? null,
    activity: lineActivity(l.kind, l.batch?.species),
    category: lineCategory(l.kind),
  };
}
