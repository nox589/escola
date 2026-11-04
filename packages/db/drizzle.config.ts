import { defineConfig } from 'drizzle-kit';

// Used only to *generate* SQL from schema.ts. Migrations are applied by src/migrate.ts,
// which supports up/down and is what CI and production run.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle-out',
});
