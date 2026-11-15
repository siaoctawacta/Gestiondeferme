import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { Card } from '../../components/ui/Card';

export interface WeightPoint {
  /** `YYYY-MM-DD` */
  date: string;
  /** In `unit`. */
  weight: number;
}

/** Average weight of a lot over its weighings, in grams (poultry) or kilograms (pigs); loaded lazily by the detail page. */
export default function WeightCurve({ points, unit }: { points: WeightPoint[]; unit: 'g' | 'kg' }) {
  const data = points.map((p) => ({ label: p.date.slice(5), weight: p.weight }));
  return (
    <Card className="mb-4 p-5">
      <h2 className="text-lg font-bold">Courbe de poids moyen ({unit})</h2>
      <div className="mt-3 h-[220px]" role="img" aria-label="Courbe de poids moyen">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 700, height: 220 }}>
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="4 4" stroke="var(--border)" />
            <XAxis dataKey="label" axisLine={{ stroke: 'var(--muted-foreground)' }} tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }} />
            <YAxis width={55} axisLine={{ stroke: 'var(--muted-foreground)' }} tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }} />
            <Line type="linear" dataKey="weight" stroke="var(--chart-1)" strokeWidth={2} dot isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
