import { Module } from '@nestjs/common';
import { HerdModule } from '../herd/herd.module';
import { FeedRegistry } from './feed-source';
import { IndicatorsService } from './indicators.service';

/** Imports `herd` (never the reverse); the feed module imports this one to register a `FeedSource`. */
@Module({
  imports: [HerdModule],
  providers: [FeedRegistry, IndicatorsService],
  exports: [FeedRegistry, IndicatorsService],
})
export class IndicatorsModule {}
