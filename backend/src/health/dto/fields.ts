import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { IsDay } from '../../herd/dto/is-day';
import { Trim } from '../../listing/list-helpers';

export const ID = 'Identifiant invalide';
export const MAX_QTY = 1_000_000;
export const MAX_DAYS = 3650;

/** Optional foreign id; `null` (PATCH) clears it. */
export const OptionalId = () =>
  applyDecorators(
    ApiPropertyOptional({ nullable: true }),
    IsOptional(),
    IsString({ message: ID }),
    IsNotEmpty({ message: ID }),
  );

/** Optional trimmed text; `null` (PATCH) clears it. */
export const OptionalText = (max: number, label: string) =>
  applyDecorators(
    ApiPropertyOptional({ nullable: true }),
    IsOptional(),
    Trim(),
    IsString({ message: `${label} invalide` }),
    MaxLength(max, { message: `${label} est trop long` }),
  );

/** A required text, trimmed, never empty. */
export const RequiredText = (max: number, label: string) =>
  applyDecorators(
    Trim(),
    IsString({ message: `${label} est requis` }),
    IsNotEmpty({ message: `${label} est requis` }),
    MaxLength(max, { message: `${label} est trop long` }),
  );

/** A PATCH field that may be left out but never be `null`. */
export const NotNull = () =>
  ValidateIf((_: unknown, value: unknown) => value !== undefined);

export const OptionalDay = () =>
  applyDecorators(
    ApiPropertyOptional({ example: '2026-11-02' }),
    IsOptional(),
    IsDay(),
  );

const QTY = 'La quantité doit être un nombre positif (2 décimales au plus)';
export const OptionalQuantity = () =>
  applyDecorators(
    ApiPropertyOptional({ nullable: true }),
    IsOptional(),
    IsNumber({ maxDecimalPlaces: 2 }, { message: QTY }),
    IsPositive({ message: QTY }),
    Max(MAX_QTY, { message: 'La quantité est trop élevée' }),
  );

const DAYS = 'Le nombre de jours doit être un entier positif ou nul';
export const OptionalDays = () =>
  applyDecorators(
    ApiPropertyOptional({ nullable: true }),
    IsOptional(),
    IsInt({ message: DAYS }),
    Min(0, { message: DAYS }),
    Max(MAX_DAYS, { message: 'Le nombre de jours est trop élevé' }),
  );
