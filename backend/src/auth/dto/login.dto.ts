import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'directeur@agripilot.local' })
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  password!: string;
}
