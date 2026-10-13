import { defineConfig } from 'drizzle-kit';

// Development only: generates the SQL migrations in drizzle/ from the schema. It never connects to a database.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/server/db/schema.ts',
  out: './drizzle',
});
