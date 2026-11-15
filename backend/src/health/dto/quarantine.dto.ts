import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { IsDay } from '../../herd/dto/is-day';
import { ListQueryDto } from '../../listing/list-query.dto';
import { NotNull, OptionalDay, OptionalId, RequiredText } from './fields';

export class QuarantineQueryDto extends ListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Le lot est invalide' })
  batchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: "L'animal est invalide" })
  animalId?: string;

  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @IsDay()
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-30' })
  @IsOptional()
  @IsDay()
  to?: string;
}

export class CreateQuarantineDto {
  @ApiPropertyOptional({ description: 'Exactly one of batchId / animalId' })
  @OptionalId()
  batchId?: string;

  @OptionalId()
  animalId?: string;

  @ApiProperty({ example: '2026-11-02' })
  @IsDay()
  startDate!: string;

  @ApiPropertyOptional({ description: 'Fin prévue' })
  @OptionalDay()
  endDate?: string;

  @ApiProperty()
  @RequiredText(300, 'Le motif')
  reason!: string;
}

/** The target never changes; a lifted quarantine is not editable. */
export class UpdateQuarantineDto {
  @ApiPropertyOptional()
  @NotNull()
  @IsDay()
  startDate?: string;

  @ApiPropertyOptional({ nullable: true })
  @OptionalDay()
  endDate?: string | null;

  @ApiPropertyOptional()
  @NotNull()
  @RequiredText(300, 'Le motif')
  reason?: string;
}

export class LiftQuarantineDto {
  @ApiProperty({ example: '2026-11-10' })
  @IsDay()
  date!: string;
}
