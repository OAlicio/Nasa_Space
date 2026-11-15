import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function databaseUrl() {
  const value = process.env.DATABASE_URL;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('DATABASE_URL is not configured. Copy .env.example to .env and configure the PostgreSQL connection.');
  }
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('DATABASE_URL is not a valid PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('DATABASE_URL must use postgres:// or postgresql:// protocol.');
  if (!parsed.password && !process.env.PGPASSWORD) throw new Error('PostgreSQL connection has no password. Set password in DATABASE_URL or PGPASSWORD.');
  return value;
}

let pool;

function getPool() {
  if (!pool) pool = new Pool({ connectionString: databaseUrl(), password: process.env.PGPASSWORD });
  return pool;
}
const schemaPath = path.join(__dirname, 'db', 'schema.sql');

async function migrate() {
  await getPool().query(await fs.readFile(schemaPath, 'utf8'));
}

async function listPlants() {
  const { rows } = await getPool().query(`
    SELECT id, name_pt, scientific_name, botanical_family, role_in_rotation,
      nitrogen_impact, nitrogen_fixation_kg_ha, climate_requirements,
      soil_requirements, angola_calendar, good_successors,
      pest_risk_if_monoculture, faostat_item, faostat_stats
    FROM plants ORDER BY id
  `);
  return {
    metadata: { region: 'Angola', source: 'PostgreSQL + FAOSTAT' },
    crops: rows.map((row) => ({
      ...row,
      nitrogen_fixation_kg_ha: Number(row.nitrogen_fixation_kg_ha)
    }))
  };
}

async function upsertPlant(crop, faostatItem, faostatStats = {}) {
  await getPool().query(`
    INSERT INTO plants (
      id, name_pt, scientific_name, botanical_family, role_in_rotation,
      nitrogen_impact, nitrogen_fixation_kg_ha, climate_requirements,
      soil_requirements, angola_calendar, good_successors,
      pest_risk_if_monoculture, faostat_item, faostat_stats
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    ON CONFLICT (id) DO UPDATE SET
      name_pt = EXCLUDED.name_pt,
      scientific_name = EXCLUDED.scientific_name,
      botanical_family = EXCLUDED.botanical_family,
      role_in_rotation = EXCLUDED.role_in_rotation,
      nitrogen_impact = EXCLUDED.nitrogen_impact,
      nitrogen_fixation_kg_ha = EXCLUDED.nitrogen_fixation_kg_ha,
      climate_requirements = EXCLUDED.climate_requirements,
      soil_requirements = EXCLUDED.soil_requirements,
      angola_calendar = EXCLUDED.angola_calendar,
      good_successors = EXCLUDED.good_successors,
      pest_risk_if_monoculture = EXCLUDED.pest_risk_if_monoculture,
      faostat_item = EXCLUDED.faostat_item,
      faostat_stats = EXCLUDED.faostat_stats,
      updated_at = NOW()
  `, [
    crop.id,
    crop.name_pt,
    crop.scientific_name,
    crop.botanical_family,
    crop.role_in_rotation,
    crop.nitrogen_impact,
    crop.nitrogen_fixation_kg_ha,
    JSON.stringify(crop.climate_requirements || {}),
    JSON.stringify(crop.soil_requirements || {}),
    JSON.stringify(crop.angola_calendar || {}),
    JSON.stringify(crop.good_successors || []),
    JSON.stringify(crop.pest_risk_if_monoculture || []),
    faostatItem,
    JSON.stringify(faostatStats || {})
  ]);
}

async function close() { if (pool) await pool.end(); }

export { close, listPlants, migrate, upsertPlant };
