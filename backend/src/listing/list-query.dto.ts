import { BadRequestException } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page: number = 1;

  @ApiPropertyOptional({ default: 25, maximum: 200 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize: number = 25;

  /** `field:asc|desc` */
  @ApiPropertyOptional({ example: 'createdAt:desc' })
  @IsOptional()
  @IsString()
  sort?: string;

  @ApiPropertyOptional({ enum: ['csv', 'xlsx'] })
  @IsOptional()
  @IsIn(['csv', 'xlsx'])
  format?: 'csv' | 'xlsx';
}

/**
 * Prisma `orderBy` from `q.sort`. A field outside `allowed` is a 400: the
 * client-supplied name never reaches Prisma unchecked.
 */
export function orderBy(
  q: ListQueryDto,
  allowed: string[],
  fallback: Record<string, 'asc' | 'desc'>,
): Record<string, 'asc' | 'desc'> {
  if (!q.sort) return fallback;
  const [field, dir = 'asc', ...rest] = q.sort.split(':');
  if (
    rest.length > 0 ||
    !allowed.includes(field) ||
    (dir !== 'asc' && dir !== 'desc')
  ) {
    throw new BadRequestException('Tri invalide');
  }
  return { [field]: dir };
}
