export interface SegmentedProps<T extends string> {
  /** Accessible name of the group. */
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}

/** A small pill-shaped choice between a few exclusive options (radio semantics). */
export function Segmented<T extends string>({ label, value, options, onChange, disabled }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-1 rounded-full bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`rounded-full px-4 py-1 text-sm font-medium transition-colors disabled:opacity-60 ${
            value === o.value ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
