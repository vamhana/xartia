import 'dotenv/config';
import { query } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

const rows = await query<{ id: string; direction_id: string }>(
  `SELECT id, direction_id FROM participants WHERE is_first_architect = true LIMIT 1`,
);
console.log(JSON.stringify(rows[0], null, 2));
await gracefulShutdown();