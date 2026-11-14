// Throwaway values for the end-to-end suite only: a dedicated database, fixed
// ports and fake credentials. None of this is a real secret.
export const API_PORT = 3100;
export const WEB_PORT = 5273;
export const API_URL = `http://localhost:${API_PORT}`;
export const WEB_URL = `http://localhost:${WEB_PORT}`;
// Overridable (E2E_DATABASE_URL), but the runner refuses anything not named agripilot_e2e.
export const DATABASE_URL = process.env.E2E_DATABASE_URL || 'postgresql://agripilot:agripilot@localhost:5432/agripilot_e2e';

export const PASSWORD = 'E2e-Throwaway-Passw0rd!';
// One seeded SUPER_ADMIN per spec file, so specs never depend on each other's 2FA state.
export const ADMINS = {
  auth: 'admin-auth@e2e.test',
  batiments: 'admin-batiments@e2e.test',
  visual: 'admin-visual@e2e.test',
} as const;

export const BACKEND_ENV = {
  DATABASE_URL,
  JWT_SECRET: 'e2e-throwaway-jwt-secret-0123456789abcdef',
  TOTP_ENC_KEY: Buffer.alloc(32, 7).toString('base64'),
  WEB_ORIGIN: WEB_URL,
  PORT: String(API_PORT),
  // The suite logs in many times from one IP: skip the 10/min auth throttle.
  NODE_ENV: 'test',
};
