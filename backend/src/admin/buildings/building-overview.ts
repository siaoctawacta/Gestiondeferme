import { ApiProperty } from '@nestjs/swagger';
import type { ModuleKey } from '../../access/permissions';
import type {
  BuildingStatus,
  BuildingType,
  EquipmentCondition,
  HealthActType,
  Species,
} from '../../generated/prisma/enums';

/**
 * What a role sees of a building's page (the one its QR label opens): each part needs the read right of
 * the module it comes from, and is `null` without it. The lots are those of the species the role reads
 * (`lots` for poultry, `porcs` for pigs), the individual animals need `porcs`.
 */
export interface OverviewAccess {
  /** Species of the lots the role may see; empty: the part is `null`. */
  species: Species[];
  animals: boolean;
  equipment: boolean;
  tasks: boolean;
  health: boolean;
}

export function overviewAccess(
  canRead: (module: ModuleKey) => boolean,
): OverviewAccess {
  return {
    species: [
      ...(canRead('lots') ? (['AVICOLE'] as const) : []),
      ...(canRead('porcs') ? (['PORCIN'] as const) : []),
    ],
    animals: canRead('porcs'),
    equipment: canRead('equipements'),
    tasks: canRead('taches'),
    health: canRead('sante'),
  };
}

export class OverviewBuildingDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['AVICOLE', 'PORCIN', 'AUTRE'] }) type!: BuildingType;
  @ApiProperty({ enum: ['ACTIF', 'VIDE_SANITAIRE', 'MAINTENANCE'] })
  status!: BuildingStatus;
}

export class OverviewSiteDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

export class OverviewLotDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty({ enum: ['AVICOLE', 'PORCIN'] }) species!: Species;
  @ApiProperty({ description: 'Live animals now' }) alive!: number;
}

export class OverviewEquipmentDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['BON', 'A_SURVEILLER', 'EN_PANNE'] })
  condition!: EquipmentCondition;
  @ApiProperty({ type: String, nullable: true, description: 'YYYY-MM-DD' })
  nextMaintenance!: string | null;
}

export class OverviewHealthActDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: 'YYYY-MM-DD' }) date!: string;
  @ApiProperty() type!: HealthActType;
  @ApiProperty({ type: String, nullable: true }) productName!: string | null;
  @ApiProperty() status!: string;
}

export class BuildingOverviewDto {
  @ApiProperty({ type: OverviewBuildingDto }) building!: OverviewBuildingDto;
  @ApiProperty({ type: OverviewSiteDto }) site!: OverviewSiteDto;
  @ApiProperty() occupation!: number;
  @ApiProperty() capacity!: number;
  @ApiProperty({
    type: [OverviewLotDto],
    nullable: true,
    description: 'Open lots; null without `lots` nor `porcs` read',
  })
  lots!: OverviewLotDto[] | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Individual animals on the farm; null without `porcs` read',
  })
  animals!: number | null;
  @ApiProperty({
    type: [OverviewEquipmentDto],
    nullable: true,
    description: 'Equipment in service; null without `equipements` read',
  })
  equipment!: OverviewEquipmentDto[] | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Open tasks of the building; null without `taches` read',
  })
  openTasks!: number | null;
  @ApiProperty({
    type: [OverviewHealthActDto],
    nullable: true,
    description: 'Five latest acts; null without `sante` read',
  })
  lastHealthActs!: OverviewHealthActDto[] | null;
}
