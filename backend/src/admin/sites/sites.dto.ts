import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Trim } from '../shared';

export class SiteDto {
  @ApiProperty()
  @Trim()
  @IsString({ message: 'Le nom est requis' })
  @IsNotEmpty({ message: 'Le nom est requis' })
  @MaxLength(100, { message: 'Le nom est trop long (100 caractères maximum)' })
  name!: string;
}
