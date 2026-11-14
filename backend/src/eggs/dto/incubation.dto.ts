import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsDay } from '../../herd/dto/is-day';
import { Trim } from '../../listing/list-helpers';
import { ListQueryDto } from '../../listing/list-query.dto';

const EGGS = "Le nombre d'œufs doit être un nombre entier supérieur à 0";
const COUNT = 'Le nombre doit être un nombre entier positif ou nul';
const MAX = 10_000_000;
const NOTE = { message: 'La note est trop longue' };

export class IncubationListQueryDto extends ListQueryDto {}

export class CreateIncubationDto {
  @ApiPropertyOptional({ description: 'Généré (INC-2026-01...) quand absent' })
  @IsOptional()
  @Trim()
  @IsString({ message: 'Le code est invalide' })
  @IsNotEmpty({ message: 'Le code est invalide' })
  @MaxLength(40, { message: 'Le code est trop long (40 caractères maximum)' })
  @Matches(/^[\w.-]+$/, {
    message: 'Le code ne peut contenir que des lettres, chiffres, - . et _',
  })
  code?: string;

  @ApiPropertyOptional({ description: 'Lot pondeuse ou reproducteur source' })
  @IsOptional()
  @IsString({ message: 'Le lot source est invalide' })
  @IsNotEmpty({ message: 'Le lot source est invalide' })
  sourceBatchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString({ message: 'La couveuse est invalide' })
  @MaxLength(100, { message: 'Le nom de la couveuse est trop long' })
  incubator?: string;

  @ApiProperty({ example: '2026-11-02' })
  @IsDay()
  startDate!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt({ message: EGGS })
  @Min(1, { message: EGGS })
  @Max(MAX, { message: "Le nombre d'œufs est trop élevé" })
  eggsSet!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString({ message: 'La note est invalide' })
  @MaxLength(1000, NOTE)
  note?: string;
}

export class UpdateIncubationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Le lot source est invalide' })
  @IsNotEmpty({ message: 'Le lot source est invalide' })
  sourceBatchId?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString({ message: 'La couveuse est invalide' })
  @MaxLength(100, { message: 'Le nom de la couveuse est trop long' })
  incubator?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDay()
  startDate?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt({ message: EGGS })
  @Min(1, { message: EGGS })
  @Max(MAX, { message: "Le nombre d'œufs est trop élevé" })
  eggsSet?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString({ message: 'La note est invalide' })
  @MaxLength(1000, NOTE)
  note?: string | null;
}

export class CandlingDto {
  @ApiProperty()
  @IsDay()
  date!: string;

  @ApiProperty({ minimum: 0 })
  @IsInt({ message: COUNT })
  @Min(0, { message: COUNT })
  @Max(MAX, { message: "Le nombre d'œufs est trop élevé" })
  fertileEggs!: number;
}

export class HatchDto {
  @ApiProperty()
  @IsDay()
  date!: string;

  @ApiProperty({ minimum: 0 })
  @IsInt({ message: COUNT })
  @Min(0, { message: COUNT })
  @Max(MAX, { message: 'Le nombre de poussins est trop élevé' })
  chicksHatched!: number;

  @ApiProperty({ description: 'Bâtiment qui accueille les poussins' })
  @IsString({ message: 'Le bâtiment est requis' })
  @IsNotEmpty({ message: 'Le bâtiment est requis' })
  buildingId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'La souche est invalide' })
  @IsNotEmpty({ message: 'La souche est invalide' })
  breedId?: string;
}

export class FailDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString({ message: 'La note est invalide' })
  @MaxLength(1000, NOTE)
  note?: string;
}
