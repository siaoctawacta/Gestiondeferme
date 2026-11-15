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
          {/*
            An amount never breaks inside its digits (`whitespace-nowrap`): the figure scales down with its tile instead.
            `1 120 000 FCFA` is ~7.8em wide: two wide tiles from `sm` keep the reference `text-3xl`; the four tiles of
            `lg` are ~165px wide at 1024 (`text-base`) and ~230px at 1280 (`text-2xl`); from 1440, where they are 271px
            (the reference layout), `text-3xl` is back.
          */}
          <p className="mt-1 min-w-0 whitespace-nowrap font-display text-lg font-bold sm:text-3xl lg:text-base xl:text-2xl min-[1440px]:text-3xl">{t.value}</p>
        </div>
      ))}
    </div>
  );
}
