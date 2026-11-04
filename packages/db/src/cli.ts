import pg from 'pg';
import { migrateDown, migrateUp } from './migrate.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const cmd = process.argv[2] ?? 'up';
  const res =
    cmd === 'down' ? await migrateDown(client, Number(process.argv[3] ?? 1)) : await migrateUp(client);
  process.stdout.write(`${cmd}: ${res.length ? res.join(', ') : 'nothing to do'}\n`);
} finally {
  await client.end();
}
