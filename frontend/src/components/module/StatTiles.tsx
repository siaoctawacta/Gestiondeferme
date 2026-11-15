export interface StatTile {
  label: string;
  value: string;
}

export function StatTiles({ tiles }: { tiles: StatTile[] }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="min-w-0 rounded-[calc(var(--radius)+10px)] bg-card p-3 shadow-card sm:p-4">
          <p className="text-xs text-muted-foreground">{t.label}</p>
          {/* On a phone the figure is smaller and may wrap inside its tile (`1 120 000 FCFA` never sticks out); from `sm` up it is the reference size. */}
          <p className="mt-1 min-w-0 font-display text-lg font-bold [overflow-wrap:anywhere] sm:text-3xl">{t.value}</p>
        </div>
      ))}
    </div>
  );
}
