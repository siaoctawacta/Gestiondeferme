export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Administrateur',
  PROPRIETAIRE: 'Propriétaire / Direction',
  DIRECTEUR_FERME: 'Directeur de ferme',
  RESP_AVICOLE: 'Responsable avicole',
  RESP_PORCIN: 'Responsable porcin',
  VETERINAIRE: 'Vétérinaire',
  RESP_STOCK: 'Responsable stock',
  COMPTABLE: 'Comptable',
  COMMERCIAL: 'Commercial',
  AGENT_ELEVAGE: "Agent d'élevage",
  MAGASINIER: 'Magasinier',
  AUDITEUR: 'Auditeur',
};

export const ROLE_OPTIONS = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }));
