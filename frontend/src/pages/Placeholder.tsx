import { Card } from '../components/ui/Card';

/** Stand-in page body until the module screens land (Tasks 10-11 and later slices). */
export function Placeholder({ title }: { title: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-4xl font-bold">{title}</h1>
      <Card className="p-6 text-sm text-muted-foreground">Cette page sera bientôt disponible.</Card>
    </div>
  );
}
