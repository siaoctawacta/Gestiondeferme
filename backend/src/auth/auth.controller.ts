import {
  Body,
  Controller,
  NotImplementedException,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../access/decorators';
import { LoginDto } from './login.dto';

// Stub: replaced by the real implementation in the authentication task.
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  @Public()
  @Post('login')
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  login(@Body() _dto: LoginDto): never {
    throw new NotImplementedException();
  }
}
