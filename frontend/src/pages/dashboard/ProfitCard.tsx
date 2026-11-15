import { formatMoney } from '../../lib/format';
import { rateOrDash, type DashboardDto } from '../../lib/dashboard';

const R = 70;
const CIRC = 2 * Math.PI * R;

function Donut({ pct }: { pct: number | null }) {
  const share = Math.min(Math.max(pct ?? 0, 0), 100) / 100;
  return (
    <div className="relative mx-auto size-40">
      <svg viewBox="0 0 160 160" className="size-full -rotate-90" aria-hidden>
        <circle cx="80" cy="80" r={R} fill="none" stroke="white" strokeOpacity={0.3} strokeWidth="20" />
        <circle
          cx="80" cy="80" r={R} fill="none" stroke="white" strokeWidth="20"
          strokeDasharray={`${CIRC * share} ${CIRC}`}
        />
        <circle cx="80" cy="80" r="60" fill="var(--primary)" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xs text-white/80">Marge</span>
        <span className="font-display text-[30px] font-bold leading-9">{rateOrDash(pct)}</span>
      </div>
    </div>
  );
}

export function ProfitCard({ profit }: { profit: NonNullable<DashboardDto['profitability']> }) {
  return (
    <div className="flex flex-col rounded-[calc(var(--radius)+10px)] bg-(image:--gradient-hero) p-5 text-white shadow-card">
      <h2 className="text-lg font-bold">Rentabilité du mois</h2>
      <div className="mt-3.5">
        <Donut pct={profit.marginPct} />
      </div>
      <dl className="mt-auto space-y-1.5 text-sm">
        <div className="flex justify-between"><dt className="text-white/80">Chiffre d'affaires</dt><dd className="font-semibold">{formatMoney(profit.revenue)}</dd></div>
        <div className="flex justify-between"><dt className="text-white/80">Dépenses</dt><dd className="font-semibold">{formatMoney(profit.expenses)}</dd></div>
        <div className="flex justify-between border-t border-white/25 pt-2"><dt className="text-white/80">Marge</dt><dd className="font-semibold">{formatMoney(profit.margin)}</dd></div>
      </dl>
    </div>
  );
}
