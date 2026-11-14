import { Link } from 'react-router';
import { MessageCard } from '../components/shell/guards';

export default function NotFound() {
  return (
    <MessageCard title="Page introuvable">
      Cette page n&apos;existe pas.{' '}
      <Link to="/" className="font-medium text-primary underline">
        Retour au tableau de bord
      </Link>
    </MessageCard>
  );
}
