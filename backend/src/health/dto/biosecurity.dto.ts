import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { IsDay } from '../../herd/dto/is-day';
import { ListQueryDto } from '../../listing/list-query.dto';
import { NotNull, OptionalId, OptionalText } from './fields';

export const LOG_TYPES = [
  'NETTOYAGE',
  'DESINFECTION',
  'PEDILUVE',
  'VISITEUR',
] as const;
export type LogTypeValue = (typeof LOG_TYPES)[number];
const TYPE = 'Le type de relevé est invalide';

export class BiosecurityQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: LOG_TYPES })
  @IsOptional()
  @IsEnum(LOG_TYPES, { message: TYPE })
  type?: LogTypeValue;

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

export class CreateBiosecurityDto {
  @ApiProperty({ example: '2026-11-02' })
  @IsDay()
  date!: string;

  @ApiProperty({ enum: LOG_TYPES })
  @IsEnum(LOG_TYPES, { message: TYPE })
  type!: LogTypeValue;

  @OptionalId()
  buildingId?: string;

  @OptionalText(120, 'Le produit')
  productName?: string;

  @OptionalText(120, 'Le nom du visiteur')
  visitorName?: string;

  @OptionalText(1000, 'La note')
  note?: string;
}

export class UpdateBiosecurityDto {
  @ApiPropertyOptional()
  @NotNull()
  @IsDay()
  date?: string;

  @ApiPropertyOptional({ enum: LOG_TYPES })
  @NotNull()
  @IsEnum(LOG_TYPES, { message: TYPE })
  type?: LogTypeValue;

  @OptionalId()
  buildingId?: string | null;

  @OptionalText(120, 'Le produit')
  productName?: string | null;

  @OptionalText(120, 'Le nom du visiteur')
  visitorName?: string | null;

  @OptionalText(1000, 'La note')
  note?: string | null;
}
