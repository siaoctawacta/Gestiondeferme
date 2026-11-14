import { config } from 'dotenv';
import { join } from 'path';

// override: true so a developer's .env can never point tests at the dev database.
config({
  path: join(__dirname, '..', '.env.test'),
  override: true,
  quiet: true,
});
