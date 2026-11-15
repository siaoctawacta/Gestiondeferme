import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { IsDay } from '../../herd/dto/is-day';
import { ListQueryDto } from '../../listing/list-query.dto';
import { NotNull, OptionalId, OptionalText, RequiredText } from './fields';

export const SEVERITIES = ['FAIBLE', 'MOYENNE', 'GRAVE'] as const;
export type SeverityValue = (typeof SEVERITIES)[number];
const SEVERITY = 'La gravité est invalide';

export class IncidentQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: SEVERITIES })
  @IsOptional()
  @IsEnum(SEVERITIES, { message: SEVERITY })
  severity?: SeverityValue;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Le lot est invalide' })
  batchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Le bâtiment est invalide' })
  buildingId?: string;

  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @IsDay()
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-30' })
  @IsOptional()
  @IsDay()
  to?: string;
}

export class CreateIncidentDto {
  @ApiProperty({ example: '2026-11-02' })
  @IsDay()
  date!: string;

  @ApiProperty()
  @RequiredText(160, 'Le titre')
  title!: string;

  @OptionalText(2000, 'La description')
  description?: string;

  @ApiProperty({ enum: SEVERITIES })
  @IsEnum(SEVERITIES, { message: SEVERITY })
  severity!: SeverityValue;

  @OptionalId()
  batchId?: string;

  @OptionalId()
  buildingId?: string;
}

export class UpdateIncidentDto {
  @ApiPropertyOptional()
  @NotNull()
  @IsDay()
  date?: string;

  @ApiPropertyOptional()
  @NotNull()
  @RequiredText(160, 'Le titre')
  title?: string;

  @OptionalText(2000, 'La description')
  description?: string | null;

  @ApiPropertyOptional({ enum: SEVERITIES })
  @NotNull()
  @IsEnum(SEVERITIES, { message: SEVERITY })
  severity?: SeverityValue;

  @OptionalId()
  batchId?: string | null;

  @OptionalId()
  buildingId?: string | null;
}
