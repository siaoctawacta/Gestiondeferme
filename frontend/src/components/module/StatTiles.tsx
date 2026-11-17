export interface StatTile {
  label: string;
  value: string;
}

/**
 * The space before a unit made of letters (`FCFA`, `kg`, `kg/jour`) becomes a plain one, so that only the unit may drop
 * to a second line; every space inside the number stays a no-break one. `12 %` keeps its no-break space.
 */
const breakBeforeUnit = (value: string): string => value.replace(/[  ]+(?=\p{L}[\p{L}/.]*$)/u, ' ');

/**
 * Four tiles make a row of four; five (the invoice page) make three then two up to `xl` and one row of five from there,
 * so that no tile sits alone on a row at desktop width; on a phone (two columns) the fifth fills the last row.
 */
export function StatTiles({ tiles }: { tiles: StatTile[] }) {
  const five = tiles.length === 5;
  return (
    <div className={`mb-6 grid grid-cols-2 gap-3 ${five ? 'lg:grid-cols-3 xl:grid-cols-5' : 'lg:grid-cols-4'}`}>
      {tiles.map((t, i) => (
        // The tile is a size container: its figure is sized from the tile's own content width (`cqw`), never from the
        // screen or from the text, so the layout is the same for `12` and `12 345 678 FCFA`.
        <div key={t.label} className={`@container min-w-0 rounded-[calc(var(--radius)+10px)] bg-card p-3 shadow-card sm:p-4 ${five && i === 4 ? 'col-span-2 lg:col-span-1' : ''}`}>
          <p className="text-xs text-muted-foreground">{t.label}</p>
          {/*
            12.6cqw is the largest size at which `12 345 678 FCFA` (7.8em) still fits one line; it reaches the reference
            `text-3xl` (30px) at the 1440px layout, whose tile content is 239px wide, and is floored at 18px. Digits never
            break (no-break spaces, no `overflow-wrap`); below ~13 characters the unit drops to a second line instead of
            the figure leaving its tile.
          */}
          <p className="mt-1 min-w-0 font-display font-bold leading-[1.2] [font-size:clamp(1.125rem,12.6cqw,1.875rem)]">{breakBeforeUnit(t.value)}</p>
        </div>
      ))}
    </div>
  );
}
