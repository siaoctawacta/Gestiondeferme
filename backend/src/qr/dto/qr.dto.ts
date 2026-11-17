import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';
import { QR_KINDS, type QrKind } from '../qr-targets';

/** Most labels one request (and one sheet) holds. */
export const QR_LABEL_MAX = 60;

export class QrLabelsDto {
  @ApiProperty({ enum: QR_KINDS })
  @IsIn(QR_KINDS, { message: 'Type de QR code invalide' })
  kind!: QrKind;

  @ApiProperty({ type: [String], maxItems: QR_LABEL_MAX })
  @IsArray({ message: 'Les identifiants sont invalides' })
  @ArrayMinSize(1, { message: 'Indiquez au moins un identifiant' })
  @ArrayMaxSize(QR_LABEL_MAX, {
    message: `Au plus ${QR_LABEL_MAX} étiquettes à la fois`,
  })
  @ArrayUnique({ message: 'Les identifiants doivent être distincts' })
  @IsString({ each: true, message: 'Les identifiants sont invalides' })
  @IsNotEmpty({ each: true, message: 'Les identifiants sont invalides' })
  @MaxLength(64, { each: true, message: 'Les identifiants sont invalides' })
  ids!: string[];
}

export class QrTargetDto {
  @ApiProperty({ enum: QR_KINDS }) kind!: QrKind;
  @ApiProperty() id!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The record’s farm; null for an article (organisation catalogue)',
  })
  farmId!: string | null;
  @ApiProperty({ type: String, nullable: true }) farmName!: string | null;
  @ApiProperty({ description: 'In-app page of the record' }) path!: string;
  @ApiProperty({
    description: '`{APP_URL}/q/{kind}/{id}`, what the QR encodes',
  })
  url!: string;
  @ApiProperty() label!: string;
  @ApiProperty() sublabel!: string;
  @ApiProperty({ description: 'The QR code as SVG text' }) svg!: string;
}

export class QrLabelsResponseDto {
  @ApiProperty({ type: [QrTargetDto] }) labels!: QrTargetDto[];
}
