import { neon } from '@neondatabase/serverless';
import { defaultData } from './defaultData';

// Serverless-friendly Postgres storage (Neon, via the Vercel Marketplace integration
// or a standalone Neon project). Replaces the old local-file node:sqlite store, which
// doesn't work on Vercel's serverless functions (no persistent disk between invocations).
//
// DATABASE_URL is injected automatically by Vercel when you add the Neon integration
// in Project Settings > Storage. For local development, copy the connection string from
// the Neon dashboard (or run `vercel env pull`) into .env.local as DATABASE_URL=...

let ensured = false;

function getSql() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Add the Neon Postgres integration in Vercel (Storage tab), ' +
      'or set DATABASE_URL in .env.local for local development.'
    );
  }
  return neon(connectionString);
}

async function ensureTable(sql: ReturnType<typeof neon>) {
  if (ensured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  ensured = true;
}

export async function readSchedulerData() {
  const sql = getSql();
  await ensureTable(sql);
  const rows = await sql`SELECT data FROM app_state WHERE id = 1;`;
  if (rows.length && rows[0].data) return rows[0].data;
  const seedJson = JSON.stringify(defaultData);
  await sql`
    INSERT INTO app_state (id, data) VALUES (1, ${seedJson}::jsonb)
    ON CONFLICT (id) DO NOTHING;
  `;
  return defaultData;
}

export async function writeSchedulerData(data: any) {
  const sql = getSql();
  await ensureTable(sql);
  const json = JSON.stringify(data);
  await sql`
    INSERT INTO app_state (id, data, updated_at) VALUES (1, ${json}::jsonb, now())
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at;
  `;
}

export function databaseInfo() {
  return { provider: 'neon-postgres', configured: !!process.env.DATABASE_URL };
}
