export const MIN_PASSWORD_LENGTH = 10;

/** Client-side check mirroring the server policy; returns a French message or null. */
export function checkNewPassword(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`;
  }
  if (password !== confirm) return 'Les mots de passe ne correspondent pas.';
  return null;
}
