import { ApiError } from '../../lib/api';

/** The server's French message for an API error, a generic one otherwise. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return 'Une erreur inattendue est survenue';
}
