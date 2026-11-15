import { Input } from '../ui/Input';

/** A labelled date input of a list's toolbar (a bound of a period); `value` is `YYYY-MM-DD` or empty. */
export function DateFilter({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
      {label}
      <Input type="date" className="h-9! w-auto! px-3!" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
