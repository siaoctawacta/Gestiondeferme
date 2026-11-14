import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsDay } from '../../herd/dto/is-day';
import { Trim } from '../../listing/list-helpers';
import { ListQueryDto } from '../../listing/list-query.dto';

const COUNT = 'Les quantités doivent être des nombres entiers positifs ou nuls';
const MAX = 10_000_000;

export class EggListQueryDto extends ListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Le lot est invalide' })
  batchId?: string;

  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @IsDay()
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-30' })
  @IsOptional()
  @IsDay()
  to?: string;
}

export class CreateEggProductionDto {
  @ApiProperty()
  @IsString({ message: 'Le lot est requis' })
  @IsNotEmpty({ message: 'Le lot est requis' })
  batchId!: string;

  @ApiProperty({ example: '2026-11-02' })
  @IsDay()
  date!: string;

  @ApiProperty({ minimum: 0 })
  @IsInt({ message: COUNT })
  @Min(0, { message: COUNT })
  @Max(MAX, { message: 'La quantité est trop élevée' })
  collected!: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt({ message: COUNT })
  @Min(0, { message: COUNT })
  @Max(MAX, { message: 'La quantité est trop élevée' })
  broken?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt({ message: COUNT })
  @Min(0, { message: COUNT })
  @Max(MAX, { message: 'La quantité est trop élevée' })
  downgraded?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt({ message: COUNT })
  @Min(0, { message: COUNT })
  @Max(MAX, { message: 'La quantité est trop élevée' })
  toIncubation?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString({ message: 'La note est invalide' })
  @MaxLength(1000, { message: 'La note est trop longue' })
  note?: string;
}

export class UpdateEggProductionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDay()
  date?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt({ message: COUNT })
  @Min(0, { message: COUNT })
  @Max(MAX, { message: 'La quantité est trop élevée' })
  collected?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt({ message: COUNT })
  @Min(0, { message: COUNT })
  @Max(MAX, { message: 'La quantité est trop élevée' })
  broken?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt({ message: COUNT })
  @Min(0, { message: COUNT })
  @Max(MAX, { message: 'La quantité est trop élevée' })
  downgraded?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt({ message: COUNT })
  @Min(0, { message: COUNT })
  @Max(MAX, { message: 'La quantité est trop élevée' })
  toIncubation?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString({ message: 'La note est invalide' })
  @MaxLength(1000, { message: 'La note est trop longue' })
  note?: string | null;
}
