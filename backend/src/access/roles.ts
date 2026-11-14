import { Role } from '../generated/prisma/enums';

export { Role };

export const ALL_ROLES: Role[] = Object.values(Role);

/** Roles that see every farm of their organisation and may use `X-Farm-Id: all`. */
export const ALL_FARMS_ROLES: Role[] = [
  'SUPER_ADMIN',
  'PROPRIETAIRE',
  'AUDITEUR',
];
