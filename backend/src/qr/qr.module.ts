import { Module } from '@nestjs/common';
import { QrController } from './qr.controller';
import { QrService } from './qr.service';

/** Reads the records of the other modules to label them; nothing imports it. */
@Module({ controllers: [QrController], providers: [QrService] })
export class QrModule {}
