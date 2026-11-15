import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Trim } from '../../listing/list-helpers';
import { ListQueryDto } from '../../listing/list-query.dto';
import { QueryBool } from '../../listing/query-bool';

export const FEED_KINDS = ['MATIERE_PREMIERE', 'ALIMENT_COMPLET'] as const;
const COST = 'Le coût doit être un nombre positif ou nul (2 décimales au plus)';
/** With `MAX_KG` below, keeps `quantityKg × unitCost` inside Decimal(14,2). */
export const MAX_UNIT_COST = 999_999;
const STOCK_ITEM_DOC =
  "Article de stock (catégorie Aliment, en kg, actif) dont l'aliment est tiré : chaque distribution y inscrit une sortie valorisée au coût moyen pondéré, sur la ferme de la distribution. Lier un article existant demande le droit maître sur l'alimentation seulement. Le coût est figé à l'écriture de la distribution : une entrée de stock ultérieure, même antidatée, recalcule les sorties du stock mais pas les distributions déjà saisies. Le lien ne peut plus changer une fois des distributions saisies (directement ou par une formule). Désactiver l'article lié reste permis et la consommation continue. Null : pas de stock, prix du catalogue.";
const KIND = "Le type d'aliment est invalide";

export class FeedProductQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: FEED_KINDS })
  @IsOptional()
  @IsEnum(FEED_KINDS, { message: KIND })
  kind?: (typeof FEED_KINDS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @QueryBool()
  @IsBoolean({ message: 'Le filtre actif est invalide' })
  active?: boolean;
}

export class CreateFeedProductDto {
  @ApiProperty()
  @Trim()
  @IsString({ message: 'Le nom est requis' })
  @IsNotEmpty({ message: 'Le nom est requis' })
  @MaxLength(120, { message: 'Le nom est trop long' })
  name!: string;

  @ApiProperty({ enum: FEED_KINDS })
  @IsEnum(FEED_KINDS, { message: KIND })
  kind!: (typeof FEED_KINDS)[number];

  @ApiProperty({ minimum: 0, description: 'FCFA par kg' })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: COST })
  @Min(0, { message: COST })
  @Max(MAX_UNIT_COST, { message: 'Le coût est trop élevé' })
  unitCost!: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean({ message: 'Le statut est invalide' })
  active?: boolean;

  @ApiPropertyOptional({ nullable: true, description: STOCK_ITEM_DOC })
  @IsOptional()
  @IsString({ message: "L'article de stock est invalide" })
  @IsNotEmpty({ message: "L'article de stock est invalide" })
  stockItemId?: string | null;
}

export class UpdateFeedProductDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString({ message: 'Le nom est requis' })
  @IsNotEmpty({ message: 'Le nom est requis' })
  @MaxLength(120, { message: 'Le nom est trop long' })
  name?: string;

  @ApiPropertyOptional({ enum: FEED_KINDS })
  @IsOptional()
  @IsEnum(FEED_KINDS, { message: KIND })
  kind?: (typeof FEED_KINDS)[number];

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: COST })
  @Min(0, { message: COST })
  @Max(MAX_UNIT_COST, { message: 'Le coût est trop élevé' })
  unitCost?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean({ message: 'Le statut est invalide' })
  active?: boolean;

  @ApiPropertyOptional({ nullable: true, description: STOCK_ITEM_DOC })
  @IsOptional()
  @IsString({ message: "L'article de stock est invalide" })
  @IsNotEmpty({ message: "L'article de stock est invalide" })
  stockItemId?: string | null;
}
