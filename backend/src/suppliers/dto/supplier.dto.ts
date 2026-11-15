import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { Trim } from '../../listing/list-helpers';
import { ListQueryDto } from '../../listing/list-query.dto';
import { QueryBool } from '../../listing/query-bool';

/** Trims an optional text; a blank one is a cleared field (null). */
const TrimOrNull = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || null : value,
  );

const NAME = 'Le nom est requis';
const EMAIL = "L'adresse email n'est pas valide";

export class SupplierQueryDto extends ListQueryDto {
  @ApiPropertyOptional({
    description: 'true: only the suppliers a new request may use',
  })
  @IsOptional()
  @QueryBool()
  @IsBoolean({ message: 'Le filtre actif est invalide' })
  active?: boolean;
}

export class CreateSupplierDto {
  @ApiProperty()
  @Trim()
  @IsString({ message: NAME })
  @IsNotEmpty({ message: NAME })
  @MaxLength(120, { message: 'Le nom est trop long' })
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @TrimOrNull()
  @IsString({ message: 'Les produits fournis sont invalides' })
  @MaxLength(500, { message: 'Les produits fournis sont trop longs' })
  products?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @TrimOrNull()
  @IsString({ message: 'Le téléphone est invalide' })
  @MaxLength(40, { message: 'Le téléphone est trop long' })
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @TrimOrNull()
  @IsEmail({}, { message: EMAIL })
  @MaxLength(120, { message: "L'adresse email est trop longue" })
  email?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @TrimOrNull()
  @IsString({ message: "L'adresse est invalide" })
  @MaxLength(300, { message: "L'adresse est trop longue" })
  address?: string | null;

  @ApiPropertyOptional({
    default: true,
    description:
      'An inactive supplier is refused by new purchase requests; its existing purchases keep working.',
  })
  @IsOptional()
  @IsBoolean({ message: 'Le statut est invalide' })
  active?: boolean;
}

export class UpdateSupplierDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString({ message: NAME })
  @IsNotEmpty({ message: NAME })
  @MaxLength(120, { message: 'Le nom est trop long' })
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @TrimOrNull()
  @IsString({ message: 'Les produits fournis sont invalides' })
  @MaxLength(500, { message: 'Les produits fournis sont trop longs' })
  products?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @TrimOrNull()
  @IsString({ message: 'Le téléphone est invalide' })
  @MaxLength(40, { message: 'Le téléphone est trop long' })
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @TrimOrNull()
  @IsEmail({}, { message: EMAIL })
  @MaxLength(120, { message: "L'adresse email est trop longue" })
  email?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @TrimOrNull()
  @IsString({ message: "L'adresse est invalide" })
  @MaxLength(300, { message: "L'adresse est trop longue" })
  address?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean({ message: 'Le statut est invalide' })
  active?: boolean;
}
