export interface StatTile {
  label: string;
  value: string;
}

export function StatTiles({ tiles }: { tiles: StatTile[] }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-[calc(var(--radius)+10px)] bg-card p-4 shadow-card">
          <p className="text-xs text-muted-foreground">{t.label}</p>
          <p className="mt-1 font-display text-3xl font-bold">{t.value}</p>
        </div>
      ))}
    </div>
  );
}
