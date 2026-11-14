import { Link } from 'react-router';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { Card } from '../../components/ui/Card';
import { EmptyData } from '../PageParts';
import type { DashboardDto } from '../../lib/dashboard';

/** Axis range rounded to a "nice" step so five ticks fall on round numbers. */
export function niceDomain(values: number[]): [number, number] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series (all zero, or a single point) still needs a range with distinct ticks.
  if (min === max) return min === 0 ? [0, 4] : [min - 2, max + 2];
  const span = max - min;
  const raw = span / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  return [Math.floor(min / step) * step, Math.ceil(max / step) * step];
}

export function EggChart({ series }: { series: DashboardDto['eggSeries'] }) {
  const data = series.map((p) => ({ label: p.date.slice(5), eggs: p.eggs }));
  const domain = data.length > 0 ? niceDomain(data.map((p) => p.eggs)) : [0, 1];
  const [lo, hi] = domain;
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) / 4) * i);

  return (
    <Card className="p-5 lg:col-span-2 lg:min-h-[340px]">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Production d'œufs</h2>
        <Link to="/m/ponte" className="text-sm font-medium text-primary hover:underline">Voir tout</Link>
      </div>
      {data.length === 0 ? (
        <EmptyData />
      ) : (
        <div className="mt-3 h-[256px]" role="img" aria-label="Production d'œufs des derniers jours">
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 700, height: 256 }}>
            <AreaChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="egg-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="4 4" stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tickLine
                axisLine={{ stroke: 'var(--muted-foreground)' }}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
              />
              <YAxis
                domain={[lo, hi]}
                ticks={ticks}
                width={65}
                axisLine={{ stroke: 'var(--muted-foreground)' }}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
              />
              <Area
                type="linear"
                dataKey="eggs"
                stroke="var(--chart-1)"
                strokeWidth={2}
                fill="url(#egg-fill)"
                dot={data.length === 1}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
