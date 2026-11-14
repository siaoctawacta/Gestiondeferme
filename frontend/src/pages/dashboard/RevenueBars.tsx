import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { Card } from '../../components/ui/Card';
import { EmptyData } from '../PageParts';
import type { DashboardDto } from '../../lib/dashboard';

/** Four equal intervals up to a round maximum (2.05M → 2.2M, ticks every 0.55M). */
export function barDomain(max: number): number[] {
  const quarter = max / 4;
  const unit = 10 ** Math.floor(Math.log10(quarter)) / 2;
  const step = Math.ceil(quarter / unit) * unit;
  return Array.from({ length: 5 }, (_, i) => step * i);
}

const millions = (v: number) => `${+(v / 1_000_000).toFixed(2)}M`;

export function RevenueBars({ rows }: { rows: DashboardDto['revenueVsExpenses'] }) {
  const max = Math.max(0, ...rows.flatMap((r) => [r.revenue, r.expenses]));
  const ticks = barDomain(max);

  return (
    <Card className="p-5">
      <h2 className="text-lg font-bold">Recettes vs dépenses</h2>
      {max === 0 ? (
        <EmptyData />
      ) : (
        <div className="mt-3 h-[219px]" role="img" aria-label="Recettes et dépenses par activité">
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 219 }}>
            <BarChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="22%" barGap={2}>
              <CartesianGrid vertical={false} strokeDasharray="4 4" stroke="var(--border)" />
              <XAxis
                dataKey="activity"
                axisLine={{ stroke: 'var(--muted-foreground)' }}
                tickLine={false}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
              />
              <YAxis
                ticks={ticks}
                domain={[0, ticks[4]]}
                tickFormatter={millions}
                width={58}
                axisLine={{ stroke: 'var(--muted-foreground)' }}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
              />
              <Bar dataKey="revenue" name="Recettes" fill="var(--chart-1)" radius={[2, 2, 0, 0]} barSize={32} isAnimationActive={false} />
              <Bar dataKey="expenses" name="Dépenses" fill="var(--chart-3)" radius={[2, 2, 0, 0]} barSize={32} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
