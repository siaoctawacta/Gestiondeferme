export interface StatTile {
  label: string;
  value: string;
}

/** A figure longer than this does not fit half a phone row at the tile's size (`1 120 000 FCFA` is 14 characters). */
const LONG_VALUE = 9;

export function StatTiles({ tiles }: { tiles: StatTile[] }) {
  // On a phone the tiles are two per row, unless one holds a long amount: then they are one per row, so it never overflows its tile.
  const stacked = tiles.some((t) => t.value.length > LONG_VALUE);
  return (
    <div className={`mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 ${stacked ? 'max-sm:grid-cols-1' : ''}`}>
      {tiles.map((t) => (
        <div key={t.label} className="rounded-[calc(var(--radius)+10px)] bg-card p-4 shadow-card">
          <p className="text-xs text-muted-foreground">{t.label}</p>
          <p className="mt-1 font-display text-3xl font-bold">{t.value}</p>
        </div>
      ))}
    </div>
  );
}
