// Run by `npm run demo:reset` before anything is dropped: exits 1 with the refusal.
import { config } from 'dotenv';
import { resetRefusal } from './demo-guards';

config({ quiet: true });
const refusal = resetRefusal(process.env);
if (refusal) {
  console.error(refusal);
  process.exit(1);
}
