import { useEffect, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Skeleton } from './PageParts';
import { MessageCard } from '../components/shell/guards';
import { ErrorRetry } from '../components/module/ErrorRetry';
import { errorMessage } from '../components/module/errorMessage';
import { api, ApiError } from '../lib/api';
import { ALL_FARMS, useAuth } from '../lib/auth';
import { isQrKind, qrEndpoint, type QrKind, type QrTarget } from '../lib/qr';
import { useFarmQuery } from '../lib/query';

/**
 * `/q/:kind/:id`: where a printed QR lands. The API says which record it is and in which farm; when that farm is another
 * one the user is assigned to, the farm is switched (as by hand) before opening the record's page. A record that does not
 * exist, one the user may not read (the API answers 404 for both) and an unknown kind show the same card; any other failure
 * shows the kit's error with a retry. Under "all farms" the active farm is kept (the records of every farm are already visible).
 */
export default function QrResolve() {
  const { kind, id } = useParams();
  const navigate = useNavigate();
  const { farmId, farms, setFarmId } = useAuth();
  // An address that names no known kind is an unknown QR: the API is not asked.
  const known = isQrKind(kind) && Boolean(id);
  const query = useFarmQuery<QrTarget>(['/qr', kind, id], () => api.get<QrTarget>(qrEndpoint(kind as QrKind, id!)), { retry: false, enabled: known });
  const done = useRef(false);
  const target = query.data;

  useEffect(() => {
    if (!target || done.current) return;
    done.current = true;
    // Only a farm of the user's, and never under "all farms" (which already shows every farm's records).
    if (target.farmId && target.farmId !== farmId && farmId !== ALL_FARMS && farms.some((f) => f.id === target.farmId)) {
      setFarmId(target.farmId);
    }
    navigate(target.path, { replace: true });
  }, [target, farmId, farms, setFarmId, navigate]);

  const notFound = !known || (query.error instanceof ApiError && query.error.status === 404);
  if (query.isError && !notFound) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <ErrorRetry message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="px-4 py-10">
        <MessageCard title="QR code inconnu ou inaccessible">
          <Link to="/" className="font-medium text-primary underline">Retour au tableau de bord</Link>
        </MessageCard>
      </div>
    );
  }
  return <Skeleton className="mx-auto h-48 max-w-md" />;
}
