/** The one loading placeholder of a dialog or a block (`className` sets its size): announced to screen readers. */
export function LoadingBlock({ className = 'h-24' }: { className?: string }) {
  return (
    <div aria-busy role="status" className={`animate-pulse rounded-3xl bg-muted ${className}`}>
      <span className="sr-only">Chargement…</span>
    </div>
  );
}
