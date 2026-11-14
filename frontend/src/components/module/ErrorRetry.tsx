import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';

/** Error message with a retry button, for any failed query. */
export function ErrorRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Alert className="flex-1">{message}</Alert>
      <Button variant="outline" onClick={onRetry}>Réessayer</Button>
    </div>
  );
}
