const fs = require('node:fs/promises');
const path = require('node:path');
require('dotenv/config');
const { Pool } = require('pg');

function databaseUrl() {
  const value = process.env.DATABASE_URL;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('DATABASE_URL não está configurada. Copie .env.example para .env e informe a ligação PostgreSQL.');
  }
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('DATABASE_URL não é uma URL PostgreSQL válida.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('DATABASE_URL deve usar o protocolo postgres:// ou postgresql://.');
  if (!parsed.password && !process.env.PGPASSWORD) throw new Error('A ligação PostgreSQL não tem password. Defina a password na DATABASE_URL ou em PGPASSWORD.');
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
  return { metadata: { region: 'Angola', source: 'PostgreSQL + FAOSTAT' }, crops: rows.map((row) => ({
    ...row,
    nitrogen_fixation_kg_ha: Number(row.nitrogen_fixation_kg_ha)
  })) };
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
    crop.id, crop.name_pt, crop.scientific_name, crop.botanical_family,
    crop.role_in_rotation, crop.nitrogen_impact, crop.nitrogen_fixation_kg_ha,
    crop.climate_requirements, crop.soil_requirements, crop.angola_calendar,
    crop.good_successors, crop.pest_risk_if_monoculture, faostatItem,
    faostatStats
  ]);
}

async function close() { if (pool) await pool.end(); }

module.exports = { close, listPlants, migrate, upsertPlant };