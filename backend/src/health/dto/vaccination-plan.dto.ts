import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ListQueryDto } from '../../listing/list-query.dto';
import {
  MAX_DAYS,
  NotNull,
  OptionalId,
  OptionalText,
  RequiredText,
} from '../../common/dto-fields';

const SPECIES = ['AVICOLE', 'PORCIN'] as const;
const BATCH_TYPES = [
  'CHAIR',
  'PONDEUSE',
  'POUSSIN',
  'REPRODUCTEUR',
  'PORCELET',
  'ENGRAISSEMENT',
] as const;
const SPECIES_MSG = "L'espèce est invalide";
const TYPE_MSG = 'Le type de lot est invalide';
const AGE = "L'âge doit être un nombre entier de jours positif ou nul";

export class PlanQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: SPECIES })
  @IsOptional()
  @IsEnum(SPECIES, { message: SPECIES_MSG })
  species?: (typeof SPECIES)[number];

  @ApiPropertyOptional({ enum: BATCH_TYPES })
  @IsOptional()
  @IsEnum(BATCH_TYPES, { message: TYPE_MSG })
  type?: (typeof BATCH_TYPES)[number];
}

export class PlanItemDto {
  @ApiProperty({
    minimum: 0,
    description: "Jours après la date d'entrée du lot",
  })
  @IsInt({ message: AGE })
  @Min(0, { message: AGE })
  @Max(MAX_DAYS, { message: "L'âge est trop élevé" })
  ageDays!: number;

  @ApiProperty()
  @RequiredText(120, 'Le produit')
  productName!: string;

  @ApiPropertyOptional({ description: 'Vaccin en stock (catégorie VACCIN)' })
  @OptionalId()
  stockItemId?: string | null;

  @OptionalText(60, 'La dose')
  dose?: string | null;
}

const ITEMS = 'Le plan doit comporter au moins une étape';

export class CreatePlanDto {
  @ApiProperty()
  @RequiredText(120, 'Le nom')
  name!: string;

  @ApiProperty({ enum: SPECIES })
  @IsEnum(SPECIES, { message: SPECIES_MSG })
  species!: (typeof SPECIES)[number];

  @ApiPropertyOptional({ enum: BATCH_TYPES, nullable: true })
  @IsOptional()
  @IsEnum(BATCH_TYPES, { message: TYPE_MSG })
  type?: (typeof BATCH_TYPES)[number] | null;

  @ApiProperty({ type: [PlanItemDto] })
  @IsArray({ message: ITEMS })
  @ArrayMinSize(1, { message: ITEMS })
  @ArrayMaxSize(50, { message: 'Le plan comporte trop d’étapes' })
  @ValidateNested({ each: true })
  @Type(() => PlanItemDto)
  items!: PlanItemDto[];
}

export class UpdatePlanDto {
  @ApiPropertyOptional()
  @NotNull()
  @RequiredText(120, 'Le nom')
  name?: string;

  @ApiPropertyOptional({ enum: SPECIES })
  @NotNull()
  @IsEnum(SPECIES, { message: SPECIES_MSG })
  species?: (typeof SPECIES)[number];

  @ApiPropertyOptional({ enum: BATCH_TYPES, nullable: true })
  @IsOptional()
  @IsEnum(BATCH_TYPES, { message: TYPE_MSG })
  type?: (typeof BATCH_TYPES)[number] | null;

  @ApiPropertyOptional({
    type: [PlanItemDto],
    description: 'Remplace toutes les étapes',
  })
  @NotNull()
  @IsArray({ message: ITEMS })
  @ArrayMinSize(1, { message: ITEMS })
  @ArrayMaxSize(50, { message: 'Le plan comporte trop d’étapes' })
  @ValidateNested({ each: true })
  @Type(() => PlanItemDto)
  items?: PlanItemDto[];
}

export class ApplyPlanDto {
  @ApiProperty()
  @IsString({ message: 'Lot invalide' })
  @IsNotEmpty({ message: 'Lot invalide' })
  batchId!: string;
}
