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

// --- Inspection -> Finalizing field-name migration ---
// The "Inspection" phase was renamed to "Finalizing" throughout the app,
// including its data field names (inspectionAssignedTo, inspectionRequired,
// inspectionHours, inspectionComplete, inspectionManualStartDate, and the
// employee capability flag canInspect). Records already saved in Postgres
// from before this rename still use the old field names. Without this shim,
// every already-scheduled finalizing assignment, requirement flag, and
// hours value would silently read as blank/false the moment this code
// deploys, because the app now looks for finalizingAssignedTo etc. and
// finds nothing under those keys.
//
// migrateRecord renames each old key to its new key IN PLACE, but only
// fills the new key if it isn't already set (so it never clobbers a value
// that was already migrated or entered fresh under the new name).
const ASSEMBLY_FIELD_RENAMES: Record<string, string> = {
  inspectionRequired: 'finalizingRequired',
  inspectionHours: 'finalizingHours',
  inspectionAssignedTo: 'finalizingAssignedTo',
  inspectionManualStartDate: 'finalizingManualStartDate',
  inspectionComplete: 'finalizingComplete',
};
const TEMPLATE_FIELD_RENAMES: Record<string, string> = {
  inspectionRequired: 'finalizingRequired',
  inspectionHours: 'finalizingHours',
};
const EMPLOYEE_FIELD_RENAMES: Record<string, string> = {
  canInspect: 'canFinalize',
};

function migrateRecord(record: any, fieldMap: Record<string, string>): boolean {
  if (!record || typeof record !== 'object') return false;
  let changed = false;
  for (const oldKey in fieldMap) {
    if (!Object.prototype.hasOwnProperty.call(record, oldKey)) continue;
    const newKey = fieldMap[oldKey];
    if (record[newKey] === undefined) record[newKey] = record[oldKey];
    delete record[oldKey];
    changed = true;
  }
  return changed;
}

function migrateInspectionFieldNames(data: any): boolean {
  if (!data || typeof data !== 'object') return false;
  let changed = false;
  const assemblyLists = [data.projectAssemblies, data.assemblies].filter(Array.isArray);
  for (const list of assemblyLists) {
    for (const assembly of list) {
      if (migrateRecord(assembly, ASSEMBLY_FIELD_RENAMES)) changed = true;
    }
  }
  for (const template of data.assemblyTemplates || []) {
    if (migrateRecord(template, TEMPLATE_FIELD_RENAMES)) changed = true;
  }
  for (const employee of data.employees || []) {
    if (migrateRecord(employee, EMPLOYEE_FIELD_RENAMES)) changed = true;
  }
  return changed;
}

export async function readSchedulerData() {
  const sql = getSql();
  await ensureTable(sql);
  const rows = await sql`SELECT data FROM app_state WHERE id = 1;`;
  if (rows.length && rows[0].data) {
    const data = rows[0].data;
    if (migrateInspectionFieldNames(data)) {
      // Old field names were found and renamed in memory above; persist the
      // upgrade so the stored JSON itself is clean and future reads don't
      // need to migrate again. Failure here isn't fatal - the in-memory
      // data returned below is already correct for this request either way.
      await writeSchedulerData(data).catch(() => {});
    }
    return data;
  }
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
