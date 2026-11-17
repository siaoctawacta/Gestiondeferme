// The legal identity of the farm and one demo user per role. The four roles whose second factor is mandatory enrol at
// their first login (nothing to prepare here).
import type { DemoContext } from './demo-client';

/** `{role}@kpalime.demo`: the role in lower case with dots (AGENT_ELEVAGE -> agent.elevage). */
export const demoEmail = (role: string): string =>
  `${role.toLowerCase().replace(/_/g, '.')}@kpalime.demo`;

export const DEMO_ROLES: { role: string; name: string }[] = [
  { role: 'SUPER_ADMIN', name: 'Démo Super administrateur' },
  { role: 'PROPRIETAIRE', name: 'Démo Propriétaire' },
  { role: 'DIRECTEUR_FERME', name: 'Démo Directeur de ferme' },
  { role: 'RESP_AVICOLE', name: 'Démo Responsable avicole' },
  { role: 'RESP_PORCIN', name: 'Démo Responsable porcin' },
  { role: 'VETERINAIRE', name: 'Démo Vétérinaire' },
  { role: 'RESP_STOCK', name: 'Démo Responsable stock' },
  { role: 'COMPTABLE', name: 'Démo Comptable' },
  { role: 'COMMERCIAL', name: 'Démo Commercial' },
  { role: 'AGENT_ELEVAGE', name: 'Démo Agent d’élevage' },
  { role: 'MAGASINIER', name: 'Démo Magasinier' },
  { role: 'AUDITEUR', name: 'Démo Auditeur' },
];

export async function seedLegalIdentity(ctx: DemoContext): Promise<void> {
  await ctx.api.put('/settings/legal', {
    value: {
      name: 'Ferme Kpalimé',
      address: "Route d'Atakpamé, Kpalimé, Togo",
      nif: 'À compléter',
      rccm: 'À compléter',
    },
  });
}

/** Creates the twelve users (all assigned to the farm) and records them in `ctx.users`. */
export async function seedUsers(
  ctx: DemoContext,
  password: string,
): Promise<void> {
  for (const { role, name } of DEMO_ROLES) {
    const user = await ctx.api.post('/users', {
      name,
      email: demoEmail(role),
      role,
      farmIds: [ctx.api.farmId],
      password,
    });
    ctx.users.set(role, user.id);
  }
}
