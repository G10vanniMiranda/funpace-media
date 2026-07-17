import 'dotenv/config';
import { runIntegrityScan } from '../server/integrity/integrity-service.js';

const reconcile = process.argv.includes('--reconcile');
const result = await runIntegrityScan({ reconcile, triggerSource: 'cli' });
console.log(JSON.stringify(result, null, 2));
