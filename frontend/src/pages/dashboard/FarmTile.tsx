import { Droplets, Wheat } from 'lucide-react';
import farm from '../../assets/farm.svg';
import { formatNumber } from '../../lib/format';

function Glass({ icon: Icon, label, value }: { icon: typeof Wheat; label: string; value: string }) {
  return (
    <div className="flex-1 rounded-2xl border border-white/20 bg-white/15 p-3 text-white backdrop-blur-md">
      <Icon aria-hidden className="size-4" />
      <p className="mt-1 text-xs text-white/80">{label}</p>
      <p className="font-display text-lg font-bold leading-6">{value}</p>
    </div>
  );
}

export interface FarmTileProps {
  activeBuildings: number;
  feedDistributedKg: number;
  waterConsumedL: number;
}

export function FarmTile({ activeBuildings, feedDistributedKg, waterConsumedL }: FarmTileProps) {
  return (
    <div className="relative min-h-[412px] overflow-hidden rounded-[calc(var(--radius)+10px)] bg-ink shadow-card">
      <img src={farm} alt="" className="absolute inset-0 size-full object-cover" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-ink/70 to-transparent" />
      <span className="absolute left-4 top-4 rounded-full bg-white px-3 py-1 text-xs font-medium text-foreground shadow-card">
        {activeBuildings} {activeBuildings > 1 ? 'bâtiments actifs' : 'bâtiment actif'}
      </span>
      <div className="absolute inset-x-4 bottom-4 flex gap-2">
        <Glass icon={Wheat} label="Aliment distribué" value={`${formatNumber(feedDistributedKg)} kg`} />
        <Glass icon={Droplets} label="Eau consommée" value={`${formatNumber(waterConsumedL)} L`} />
      </div>
    </div>
  );
}
