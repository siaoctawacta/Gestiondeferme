import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { IsDay } from '../../herd/dto/is-day';
import { ListQueryDto } from '../../listing/list-query.dto';
import {
  NotNull,
  OptionalId,
  OptionalText,
  RequiredText,
} from '../../common/dto-fields';

export const CONTRACT_TYPES = ['CDI', 'CDD', 'JOURNALIER', 'STAGE'] as const;
export type ContractTypeValue = (typeof CONTRACT_TYPES)[number];
const CONTRACT = 'Le contrat est invalide';
const SALARY =
  'Le salaire doit être un nombre positif ou nul (2 décimales au plus)';
export const MAX_SALARY = 1_000_000_000;

/** Optional monthly salary; `null` (PATCH) clears it. */
const OptionalSalary = () =>
  applyDecorators(
    ApiPropertyOptional({ nullable: true }),
    IsOptional(),
    IsNumber({ maxDecimalPlaces: 2 }, { message: SALARY }),
    Min(0, { message: SALARY }),
    Max(MAX_SALARY, { message: 'Le salaire est trop élevé' }),
  );

/** Optional calendar date; `null` (PATCH) clears it. */
const OptionalNullableDay = (example: string) =>
  applyDecorators(
    ApiPropertyOptional({ example, nullable: true }),
    IsOptional(),
    IsDay(),
  );

export class EmployeeQueryDto extends ListQueryDto {}

export class EmployeeOptionsQueryDto {
  @ApiPropertyOptional({ example: '2026-10-20' })
  @IsOptional()
  @IsDay()
  at?: string;
}

export class PayrollQueryDto {
  @ApiProperty({ example: '2026-10' })
  @IsString({ message: 'Mois invalide (AAAA-MM)' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Mois invalide (AAAA-MM)' })
  month!: string;
}

export class CreateEmployeeDto {
  @ApiProperty({ example: 'Kodjo A.' })
  @RequiredText(80, 'Le nom')
  name!: string;

  @OptionalText(160, 'Le nom complet')
  fullName?: string;

  @ApiProperty()
  @RequiredText(120, 'Le poste')
  jobTitle!: string;

  @OptionalText(40, 'Le téléphone')
  phone?: string;

  @ApiProperty({ enum: CONTRACT_TYPES })
  @IsEnum(CONTRACT_TYPES, { message: CONTRACT })
  contractType!: ContractTypeValue;

  @ApiProperty({ example: '2026-01-05' })
  @IsDay()
  hireDate!: string;

  @OptionalNullableDay('2026-12-31')
  endDate?: string;

  @OptionalSalary()
  monthlySalary?: number;

  @OptionalId()
  userId?: string;

  @OptionalText(2000, 'La note')
  note?: string;
}

export class UpdateEmployeeDto {
  @ApiPropertyOptional()
  @NotNull()
  @RequiredText(80, 'Le nom')
  name?: string;

  @OptionalText(160, 'Le nom complet')
  fullName?: string | null;

  @ApiPropertyOptional()
  @NotNull()
  @RequiredText(120, 'Le poste')
  jobTitle?: string;

  @OptionalText(40, 'Le téléphone')
  phone?: string | null;

  @ApiPropertyOptional({ enum: CONTRACT_TYPES })
  @NotNull()
  @IsEnum(CONTRACT_TYPES, { message: CONTRACT })
  contractType?: ContractTypeValue;

  @ApiPropertyOptional()
  @NotNull()
  @IsDay()
  hireDate?: string;

  @OptionalNullableDay('2026-12-31')
  endDate?: string | null;

  @OptionalSalary()
  monthlySalary?: number | null;

  @OptionalId()
  userId?: string | null;

  @OptionalText(2000, 'La note')
  note?: string | null;
}
