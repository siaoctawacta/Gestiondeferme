import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { MAX_PASSWORD_LENGTH } from '../password';

export class TwoFactorCodeDto {
  @ApiProperty({ description: 'Code TOTP à 6 chiffres ou code de secours' })
  // `123 456` is a natural way to type a TOTP code: spaces never count.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/\s+/g, '') : value,
  )
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
