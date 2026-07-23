import { neon } from '@neondatabase/serverless';
import { defaultData } from './defaultData';

// Serverless-friendly Postgres storage (Neon, via the Vercel Marketplace integration
// or a standalone Neon project).
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
  await sql`
    CREATE TABLE IF NOT EXISTS app_backups (
      id SERIAL PRIMARY KEY,
      reason TEXT NOT NULL DEFAULT 'manual',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  ensured = true;
}

export async function readSchedulerData() {
  const sql = getSql();
  await ensureTable(sql);
  const rows = await sql`SELECT data, updated_at::text AS updated_at FROM app_state WHERE id = 1;`;
  if (rows.length && rows[0].data) {
    return { data: rows[0].data, updatedAt: String(rows[0].updated_at) };
  }
  const seedJson = JSON.stringify(defaultData);
  await sql`
    INSERT INTO app_state (id, data) VALUES (1, ${seedJson}::jsonb)
    ON CONFLICT (id) DO NOTHING;
  `;
  const seeded = await sql`SELECT data, updated_at::text AS updated_at FROM app_state WHERE id = 1;`;
  return { data: seeded[0]?.data || defaultData, updatedAt: String(seeded[0]?.updated_at || '') };
}

// Conditional write: only saves if the caller's baseUpdatedAt matches the row's
// updated_at (prevents a stale browser tab from silently overwriting newer data).
// Pass an empty baseUpdatedAt to force-write (first save, or explicit override).
export async function writeSchedulerData(data: any, baseUpdatedAt = '') {
  const sql = getSql();
  await ensureTable(sql);
  const json = JSON.stringify(data);
  if (baseUpdatedAt) {
    const rows = await sql`
      UPDATE app_state SET data = ${json}::jsonb, updated_at = now()
      WHERE id = 1 AND updated_at::text = ${baseUpdatedAt}
      RETURNING updated_at::text AS updated_at;
    `;
    if (rows.length) return { ok: true, updatedAt: String(rows[0].updated_at) };
    const current = await sql`SELECT updated_at::text AS updated_at FROM app_state WHERE id = 1;`;
    if (!current.length) {
      // Row vanished; insert fresh.
      const inserted = await sql`
        INSERT INTO app_state (id, data) VALUES (1, ${json}::jsonb)
        ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
        RETURNING updated_at::text AS updated_at;
      `;
      return { ok: true, updatedAt: String(inserted[0].updated_at) };
    }
    return { ok: false, conflict: true, currentUpdatedAt: String(current[0].updated_at) };
  }
  const rows = await sql`
    INSERT INTO app_state (id, data, updated_at) VALUES (1, ${json}::jsonb, now())
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
    RETURNING updated_at::text AS updated_at;
  `;
  return { ok: true, updatedAt: String(rows[0].updated_at) };
}

export async function createServerBackup(reason = 'manual') {
  const sql = getSql();
  await ensureTable(sql);
  await sql`
    INSERT INTO app_backups (reason, data)
    SELECT ${reason}, data FROM app_state WHERE id = 1;
  `;
  // Keep the most recent 40 snapshots.
  await sql`
    DELETE FROM app_backups
    WHERE id NOT IN (SELECT id FROM app_backups ORDER BY created_at DESC LIMIT 40);
  `;
}

export async function listServerBackups() {
  const sql = getSql();
  await ensureTable(sql);
  const rows = await sql`
    SELECT id, reason, created_at,
      jsonb_array_length(COALESCE(data->'employees','[]'::jsonb)) AS employees,
      jsonb_array_length(COALESCE(data->'projects','[]'::jsonb)) AS projects,
      jsonb_array_length(COALESCE(data->'assemblyTemplates','[]'::jsonb)) AS library,
      jsonb_array_length(COALESCE(data->'projectAssemblies','[]'::jsonb)) AS project_assemblies
    FROM app_backups ORDER BY created_at DESC;
  `;
  return rows.map((r: any) => ({
    id: r.id,
    reason: r.reason,
    createdAt: String(r.created_at),
    counts: { employees: r.employees, projects: r.projects, library: r.library, projectAssemblies: r.project_assemblies },
  }));
}

export async function getServerBackup(id: number) {
  const sql = getSql();
  await ensureTable(sql);
  const rows = await sql`SELECT data FROM app_backups WHERE id = ${id};`;
  return rows.length ? rows[0].data : null;
}

export async function restoreServerBackup(id: number) {
  const sql = getSql();
  await ensureTable(sql);
  await createServerBackup('before-restore');
  const rows = await sql`
    UPDATE app_state SET data = (SELECT data FROM app_backups WHERE id = ${id}), updated_at = now()
    WHERE id = 1 AND EXISTS (SELECT 1 FROM app_backups WHERE id = ${id})
    RETURNING updated_at::text AS updated_at;
  `;
  return rows.length ? { ok: true, updatedAt: String(rows[0].updated_at) } : { ok: false };
}

export async function deleteServerBackup(id: number) {
  const sql = getSql();
  await ensureTable(sql);
  await sql`DELETE FROM app_backups WHERE id = ${id};`;
}

export function databaseInfo() {
  return { provider: 'neon-postgres', configured: !!process.env.DATABASE_URL };
}
