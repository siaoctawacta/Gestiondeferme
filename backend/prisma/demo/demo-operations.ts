// Personnel (employees and a week of attendance, the payroll entry), tasks and equipment with their interventions: the
// rows of m_taches and m_equipements plus what the alerts, the attendance sheet and the reports need.
import type { DemoContext } from './demo-client';
import { lastWorkingDays, payrollPeriod, ref } from './demo-dates';
import type { ProductionIds } from './demo-production';

export interface EmployeeIds {
  kodjo: string;
  koffi: string;
  yawa: string;
  ama: string;
}

export async function seedPersonnel(ctx: DemoContext): Promise<EmployeeIds> {
  const { api } = ctx;
  const post = api.post.bind(api);
  const employee = async (body: object) => (await post('/employees', body)).id;
  const ids: EmployeeIds = {
    kodjo: await employee({
      name: 'Kodjo A.',
      fullName: 'Kodjo Amegah',
      jobTitle: "Agent d'élevage",
      phone: '+228 90 10 20 30',
      contractType: 'CDI',
      hireDate: '2025-01-06',
      monthlySalary: 85000,
      userId: ctx.users.get('AGENT_ELEVAGE'),
    }),
    koffi: await employee({
      name: 'Dr Koffi',
      fullName: 'Dr Koffi Mensah',
      jobTitle: 'Vétérinaire',
      phone: '+228 91 20 30 40',
      contractType: 'CDD',
      hireDate: '2026-01-01',
      monthlySalary: 250000,
      userId: ctx.users.get('VETERINAIRE'),
    }),
    yawa: await employee({
      name: 'Yawa M.',
      fullName: 'Yawa Mawuli',
      jobTitle: 'Ouvrière',
      phone: '+228 92 30 40 50',
      contractType: 'JOURNALIER',
      hireDate: '2026-03-01',
      monthlySalary: 60000,
    }),
    ama: await employee({
      name: 'Ama K.',
      fullName: 'Ama Kokou',
      jobTitle: "Agent d'élevage",
      phone: '+228 93 40 50 60',
      contractType: 'CDI',
      hireDate: '2024-06-01',
      monthlySalary: 80000,
    }),
  };

  // The attendance of the last five working days, one sheet a day.
  const week = lastWorkingDays(5);
  for (const [index, date] of week.entries()) {
    const present = (employeeId: string, hours = 8) => ({
      employeeId,
      status: 'PRESENT',
      hours,
    });
    await post('/attendance/day', {
      date,
      entries: [
        index === 1
          ? {
              employeeId: ids.kodjo,
              status: 'MALADIE',
              note: 'Certificat médical',
            }
          : present(ids.kodjo),
        present(ids.koffi, index % 2 === 0 ? 6 : 8),
        index === 3
          ? { employeeId: ids.yawa, status: 'ABSENT' }
          : present(ids.yawa),
        index === 4
          ? { employeeId: ids.ama, status: 'CONGE', note: 'Congé annuel' }
          : present(ids.ama),
      ],
    });
  }

  // The payroll of last month, posted as the accountant does from the preview, dated the first of the current month.
  const { month, entryDate } = payrollPeriod();
  const payroll = await api.get<{ label: string; total: number }>(
    `/employees/payroll?month=${month}`,
  );
  await post('/finance/entries', {
    date: entryDate,
    kind: 'DEPENSE',
    label: payroll.label,
    activity: 'GENERAL',
    category: 'SALAIRES',
    amount: payroll.total,
  });
  return ids;
}

export async function seedTasks(
  ctx: DemoContext,
  production: ProductionIds,
  employees: EmployeeIds,
): Promise<void> {
  const post = ctx.api.post.bind(ctx.api);
  const weighing = await post('/tasks', {
    title: 'Pesée hebdomadaire LC-2026-14',
    assigneeId: employees.kodjo,
    dueDate: ref('2026-10-23'),
    priority: 'NORMALE',
    batchId: production.lots['LC-2026-14'],
    recurrence: 'HEBDOMADAIRE',
  });
  void weighing;
  await post('/tasks', {
    title: 'Vaccination Gumboro LC-2026-15',
    assigneeId: employees.koffi,
    dueDate: ref('2026-10-24'),
    priority: 'HAUTE',
    batchId: production.lots['LC-2026-15'],
  });
  const cleaning = await post('/tasks', {
    title: 'Nettoyage Porcherie 2',
    assigneeId: employees.yawa,
    dueDate: ref('2026-10-18'),
    priority: 'URGENTE',
    buildingId: ctx.buildings.get('Porcherie 2'),
  });
  await post(`/tasks/${cleaning.id}/start`);
  const collect = await post('/tasks', {
    title: 'Collecte des œufs',
    assigneeId: employees.ama,
    dueDate: ref('2026-10-22'),
    priority: 'NORMALE',
    buildingId: ctx.buildings.get('Pondoir C'),
  });
  await post(`/tasks/${collect.id}/complete`, {});
}

export async function seedEquipment(ctx: DemoContext): Promise<void> {
  const { api } = ctx;
  const post = api.post.bind(api);
  const sites = new Map(
    (await api.list<{ id: string; name: string }>('/sites')).map((s) => [
      s.name,
      s.id,
    ]),
  );
  const equipment = async (body: object) => (await post('/equipment', body)).id;

  const groupe = await equipment({
    name: 'Groupe électrogène 20 kVA',
    type: 'GROUPE_ELECTROGENE',
    siteId: sites.get('Site Nord'),
    brand: 'Perkins',
    serialNumber: 'GE-20-0417',
    purchaseDate: '2024-03-15',
    maintenanceIntervalDays: 90,
  });
  await post('/maintenance', {
    equipmentId: groupe,
    kind: 'PREVENTIVE',
    date: ref('2026-07-30'),
    description: 'Vidange',
    performedBy: 'Atelier Mécano Kpalimé',
    cost: 35000,
    nextDate: ref('2026-10-30'),
  });

  const couveuse = await equipment({
    name: 'Couveuse 1200 œufs',
    type: 'COUVEUSE',
    siteId: sites.get('Incubation'),
    brand: 'Brinsea',
    purchaseDate: '2025-02-10',
    maintenanceIntervalDays: 120,
    firstMaintenanceDate: ref('2026-10-25'),
  });
  await api.patch(`/equipment/${couveuse}`, { condition: 'A_SURVEILLER' });
  await post('/maintenance', {
    equipmentId: couveuse,
    kind: 'PREVENTIVE',
    date: ref('2026-06-25'),
    description: 'Étalonnage du thermostat',
    performedBy: 'Technicien Brinsea',
    cost: 18000,
    nextDate: ref('2026-10-25'),
  });

  // The pump's first maintenance is the day after the capture of the reference, so it is never due on the day the demo is loaded.
  await equipment({
    name: 'Pompe forage',
    type: 'POMPE',
    siteId: sites.get('Site Sud'),
    brand: 'Grundfos',
    purchaseDate: '2025-06-01',
    maintenanceIntervalDays: 180,
    firstMaintenanceDate: ref('2026-11-15'),
  });

  const ventilateur = await equipment({
    name: 'Ventilateur Poulailler B #3',
    type: 'VENTILATEUR',
    buildingId: ctx.buildings.get('Poulailler B'),
    purchaseDate: '2025-03-10',
    maintenanceIntervalDays: 365,
    firstMaintenanceDate: ref('2026-10-20'),
  });
  // A breakdown repaired in August (a corrective intervention with its cost), then the one of the 2nd of November, still open.
  await post(`/equipment/${ventilateur}/breakdowns`, {
    date: ref('2026-08-12'),
    description: 'Courroie cassée',
  });
  await post('/maintenance', {
    equipmentId: ventilateur,
    kind: 'CORRECTIVE',
    date: ref('2026-08-14'),
    description: 'Remplacement de la courroie',
    performedBy: 'Atelier Mécano Kpalimé',
    cost: 12000,
    repairsBreakdown: true,
    nextDate: ref('2026-10-20'),
  });
  await post(`/equipment/${ventilateur}/breakdowns`, {
    date: ref('2026-11-02'),
    description: 'Moteur grillé',
  });

  // An old scale put out of service (the « Réformés » tab).
  const balance = await equipment({
    name: 'Balance mécanique 30 kg',
    type: 'BALANCE',
    siteId: sites.get('Site Sud'),
    purchaseDate: '2021-05-20',
  });
  await post(`/equipment/${balance}/retire`, { date: ref('2026-09-01') });
}
