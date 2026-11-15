import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { CustomerType } from '../../generated/prisma/enums';
import { Trim, TrimOrNull } from '../../listing/list-helpers';
import { ListQueryDto } from '../../listing/list-query.dto';
import { QueryBool } from '../../listing/query-bool';

const NAME = 'Le nom est requis';
const TYPE = 'Le type de client est invalide';
const EMAIL = "L'adresse email n'est pas valide";

export class CustomerQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: CustomerType })
  @IsOptional()
  @IsEnum(CustomerType, { message: TYPE })
  type?: CustomerType;

  @ApiPropertyOptional({
    description: 'true: only the customers a new document may use',
  })
  @IsOptional()
  @QueryBool()
  @IsBoolean({ message: 'Le filtre actif est invalide' })
  active?: boolean;
}

export class CreateCustomerDto {
  @ApiProperty()
  @Trim()
  @IsString({ message: NAME })
  @IsNotEmpty({ message: NAME })
  @MaxLength(120, { message: 'Le nom est trop long' })
  name!: string;

  @ApiProperty({ enum: CustomerType })
  @IsEnum(CustomerType, { message: TYPE })
  type!: CustomerType;

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
  @IsString({ message: 'La ville est invalide' })
  @MaxLength(80, { message: 'La ville est trop longue' })
  city?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @TrimOrNull()
  @IsString({ message: "L'adresse est invalide" })
  @MaxLength(300, { message: "L'adresse est trop longue" })
  address?: string | null;

  @ApiPropertyOptional({
    default: true,
    description:
      'An inactive customer is refused by new documents; its existing documents keep working.',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean({ message: 'Le statut est invalide' })
  active?: boolean;
}

export class UpdateCustomerDto {
  @ApiPropertyOptional()
  @ValidateIf((_o, v) => v !== undefined)
  @Trim()
  @IsString({ message: NAME })
  @IsNotEmpty({ message: NAME })
  @MaxLength(120, { message: 'Le nom est trop long' })
  name?: string;

  @ApiPropertyOptional({ enum: CustomerType })
  @ValidateIf((_o, v) => v !== undefined)
  @IsEnum(CustomerType, { message: TYPE })
  type?: CustomerType;

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
  @IsString({ message: 'La ville est invalide' })
  @MaxLength(80, { message: 'La ville est trop longue' })
  city?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @TrimOrNull()
  @IsString({ message: "L'adresse est invalide" })
  @MaxLength(300, { message: "L'adresse est trop longue" })
  address?: string | null;

  @ApiPropertyOptional()
  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean({ message: 'Le statut est invalide' })
  active?: boolean;
}
