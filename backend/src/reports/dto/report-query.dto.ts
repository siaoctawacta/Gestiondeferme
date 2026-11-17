import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { IsDay } from '../../herd/dto/is-day';

/** The period inputs of a report: `date` for the daily to annual types, `from` / `to` for the sanitary and zootechnical ones; `format` asks for a file. */
export class ReportQueryDto {
  @ApiPropertyOptional({
    example: '2026-10-22',
    description:
      'Any day of the day, week, month or year reported (quotidien, hebdomadaire, mensuel, annuel); today by default',
  })
  @IsOptional()
  @IsDay()
  date?: string;

  @ApiPropertyOptional({
    example: '2026-10-01',
    description: 'sanitaire, zootechnique',
  })
  @IsOptional()
  @IsDay()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-31',
    description: 'sanitaire, zootechnique',
  })
  @IsOptional()
  @IsDay()
  to?: string;

  @ApiPropertyOptional({ enum: ['csv', 'xlsx'] })
  @IsOptional()
  @IsIn(['csv', 'xlsx'])
  format?: 'csv' | 'xlsx';
}
