import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { MAX_PASSWORD_LENGTH } from '../password';

export class TwoFactorCodeDto {
  @ApiProperty({ description: 'Code TOTP à 6 chiffres ou code de secours' })
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  code!: string;
}

export class DisableTwoFactorDto extends TwoFactorCodeDto {
  @ApiProperty()
  @IsString()
  @MaxLength(MAX_PASSWORD_LENGTH)
  password!: string;
}
