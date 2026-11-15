import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

if (process.loadEnvFile) {
  try { process.loadEnvFile(); } catch {}
}

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
    SELECT id, name_en, name_pt, scientific_name, botanical_family, role_in_rotation,
      nitrogen_impact, nitrogen_fixation_kg_ha, climate_requirements,
      soil_requirements, angola_calendar, good_successors,
      pest_risk_if_monoculture, faostat_item, faostat_stats,
      gaez_code, gaez_stats
    FROM plants ORDER BY id
  `);
  return {
    metadata: { region: 'Angola', source: 'PostgreSQL + FAOSTAT + FAO GAEZ v4' },
    crops: rows.map((row) => ({
      ...row,
      name: row.name_en || row.name_pt,
      nitrogen_fixation_kg_ha: Number(row.nitrogen_fixation_kg_ha)
    }))
  };
}

async function upsertPlant(crop, faostatItem, faostatStats = {}) {
  const nameEn = crop.name_en || crop.name_pt;
  const gaezCode = crop.gaez_code || null;
  const gaezStats = crop.gaez_stats || {};

  await getPool().query(`
    INSERT INTO plants (
      id, name_en, name_pt, scientific_name, botanical_family, role_in_rotation,
      nitrogen_impact, nitrogen_fixation_kg_ha, climate_requirements,
      soil_requirements, angola_calendar, good_successors,
      pest_risk_if_monoculture, faostat_item, faostat_stats,
      gaez_code, gaez_stats
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    ON CONFLICT (id) DO UPDATE SET
      name_en = EXCLUDED.name_en,
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
      gaez_code = EXCLUDED.gaez_code,
      gaez_stats = EXCLUDED.gaez_stats,
      updated_at = NOW()
  `, [
    crop.id,
    nameEn,
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
    JSON.stringify(faostatStats || {}),
    gaezCode,
    JSON.stringify(gaezStats || {})
  ]);
}

async function upsertGaezCrop(crop) {
  await getPool().query(`
    INSERT INTO gaez_crops (
      code, name_en, name_pt, scientific_name, botanical_family,
      crop_group, photosynthetic_pathway, water_need_mm_min, water_need_mm_max,
      cycle_days_min, cycle_days_max, drought_tolerance, angola_relevance, summary_stats
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    ON CONFLICT (code) DO UPDATE SET
      name_en = EXCLUDED.name_en,
      name_pt = EXCLUDED.name_pt,
      scientific_name = EXCLUDED.scientific_name,
      botanical_family = EXCLUDED.botanical_family,
      crop_group = EXCLUDED.crop_group,
      photosynthetic_pathway = EXCLUDED.photosynthetic_pathway,
      water_need_mm_min = EXCLUDED.water_need_mm_min,
      water_need_mm_max = EXCLUDED.water_need_mm_max,
      cycle_days_min = EXCLUDED.cycle_days_min,
      cycle_days_max = EXCLUDED.cycle_days_max,
      drought_tolerance = EXCLUDED.drought_tolerance,
      angola_relevance = EXCLUDED.angola_relevance,
      summary_stats = EXCLUDED.summary_stats,
      updated_at = NOW()
  `, [
    crop.code,
    crop.name_en,
    crop.name_pt,
    crop.scientific_name,
    crop.botanical_family,
    crop.crop_group,
    crop.photosynthetic_pathway,
    crop.water_need_mm_min,
    crop.water_need_mm_max,
    crop.cycle_days_min,
    crop.cycle_days_max,
    crop.drought_tolerance,
    crop.angola_relevance,
    JSON.stringify(crop.summary_stats || {})
  ]);
}

async function listGaezCrops() {
  const { rows } = await getPool().query(`
    SELECT code, name_en, name_pt, scientific_name, botanical_family,
      crop_group, photosynthetic_pathway, water_need_mm_min, water_need_mm_max,
      cycle_days_min, cycle_days_max, drought_tolerance, angola_relevance, summary_stats
    FROM gaez_crops ORDER BY code
  `);
  return {
    metadata: { source: 'FAO GAEZ v4', total: rows.length },
    crops: rows
  };
}

async function close() { if (pool) await pool.end(); }

export { close, getPool, listGaezCrops, listPlants, migrate, upsertGaezCrop, upsertPlant };
