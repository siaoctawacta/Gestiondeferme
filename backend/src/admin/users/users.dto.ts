import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../../auth/password';
import { Role } from '../../generated/prisma/enums';
import { Trim } from '../shared';

const NAME = 'Le nom est requis';
const ROLE = 'Rôle invalide';
const FARMS = 'Liste de fermes invalide';

const normalizeEmail = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );

export class CreateUserDto {
  @ApiProperty()
  @Trim()
  @IsString({ message: NAME })
  @IsNotEmpty({ message: NAME })
  @MaxLength(100, { message: 'Le nom est trop long (100 caractères maximum)' })
  name!: string;

  @ApiProperty()
  @normalizeEmail()
  @IsEmail({}, { message: 'Adresse e-mail invalide' })
  @MaxLength(254, { message: 'Adresse e-mail trop longue' })
  email!: string;

  @ApiProperty({ enum: Role })
  @IsEnum(Role, { message: ROLE })
  role!: Role;

  @ApiProperty({ type: [String] })
  @IsArray({ message: FARMS })
  @ArrayMaxSize(100, { message: FARMS })
  @IsString({ each: true, message: FARMS })
  farmIds!: string[];

  @ApiProperty({ minLength: MIN_PASSWORD_LENGTH })
  @IsString({ message: 'Mot de passe invalide' })
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères`,
  })
  @MaxLength(MAX_PASSWORD_LENGTH, { message: 'Mot de passe trop long' })
  password!: string;
}

/** The password is deliberately absent: it changes through reset links only. */
export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString({ message: NAME })
  @IsNotEmpty({ message: NAME })
  @MaxLength(100, { message: 'Le nom est trop long (100 caractères maximum)' })
  name?: string;

  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsEnum(Role, { message: ROLE })
  role?: Role;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean({ message: 'Le statut actif est invalide' })
  active?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray({ message: FARMS })
  @ArrayMaxSize(100, { message: FARMS })
  @IsString({ each: true, message: FARMS })
  farmIds?: string[];
}
