import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { close, migrate, upsertGaezCrop, upsertPlant } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const catalogPath = path.join(__dirname, '..', 'data', 'gaez_crops_catalog.json');
const barleySummaryPath = path.join(__dirname, '..', 'data', 'gaez_barley_summary.json');
const plantsJsonPath = path.join(__dirname, '..', 'plants.json');

/**
 * Convert a GAEZ crop catalog entry into a plants-table-compatible object.
 * The 8 crops already in plants.json have richer agronomic data; this function
 * creates reasonable defaults for the remaining 43 GAEZ-only crops so the
 * frontend can display them all from the single `plants` table.
 */
function gaezToPlant(gaez, summaryStats = {}) {
  // Derive an id from the code (e.g. "ban" -> "ban", readable but unique)
  const id = gaez.code;

  // Map crop_group to a generic role_in_rotation
  const groupLower = (gaez.crop_group || '').toLowerCase();
  let role = 'Supplementary Crop';
  if (groupLower.includes('legume') || groupLower.includes('leguminosa')) {
    role = 'Nitrogen Fixer / Rotation Crop';
  } else if (groupLower.includes('cereal') || groupLower.includes('pseudocereal')) {
    role = 'Main Crop / Cereal';
  } else if (groupLower.includes('hort') || groupLower.includes('vegetable')) {
    role = 'Horticultural Crop';
  } else if (groupLower.includes('fruit') || groupLower.includes('perennial')) {
    role = 'Perennial / Fruit Crop';
  } else if (groupLower.includes('oilseed') || groupLower.includes('oil')) {
    role = 'Oil / Cash Crop';
  } else if (groupLower.includes('bioenergy') || groupLower.includes('forage') || groupLower.includes('biomass')) {
    role = 'Biomass / Forage Crop';
  } else if (groupLower.includes('root') || groupLower.includes('tuber')) {
    role = 'Root / Tuber Crop';
  } else if (groupLower.includes('sugar')) {
    role = 'Sugar Crop';
  } else if (groupLower.includes('fiber') || groupLower.includes('industrial')) {
    role = 'Fiber / Industrial Crop';
  }

  // Estimate nitrogen fixation for legumes
  const isLegume = (gaez.botanical_family || '').toLowerCase() === 'fabaceae';
  const nitrogenFixation = isLegume ? 40 : 0;
  const nitrogenImpact = isLegume
    ? 'Biological nitrogen fixer (enriches soil)'
    : 'Consumer (does not fix nitrogen)';

  return {
    id,
    name_en: gaez.name_en,
    name_pt: gaez.name_pt,
    scientific_name: gaez.scientific_name,
    botanical_family: gaez.botanical_family,
    role_in_rotation: role,
    nitrogen_impact: nitrogenImpact,
    nitrogen_fixation_kg_ha: nitrogenFixation,
    climate_requirements: {
      water_need_mm_min: gaez.water_need_mm_min || 400,
      water_need_mm_max: gaez.water_need_mm_max || 600,
      drought_tolerance: gaez.drought_tolerance || 'Medium',
      ...(gaez.photosynthetic_pathway ? { photosynthetic_pathway: gaez.photosynthetic_pathway } : {})
    },
    soil_requirements: {},
    angola_calendar: {
      cycle_days_min: gaez.cycle_days_min || 90,
      cycle_days_max: gaez.cycle_days_max || 150,
      cycle_days: Math.round(((gaez.cycle_days_min || 90) + (gaez.cycle_days_max || 150)) / 2)
    },
    good_successors: [],
    pest_risk_if_monoculture: [],
    faostat_item: null,
    faostat_stats: {},
    gaez_code: gaez.code,
    gaez_stats: summaryStats
  };
}

async function seedGaez() {
  await migrate();
  console.log('PostgreSQL schema migrations applied.');

  // 1. Read GAEZ 51 crops catalog
  const catalogData = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
  let barleyStats = {};

  try {
    barleyStats = JSON.parse(await fs.readFile(barleySummaryPath, 'utf8'));
    console.log('Loaded extracted Barley GAEZ CSV summary for Angola basins.');
  } catch {
    console.warn('Barley summary not found; proceeding with general catalog metadata.');
  }

  // 2. Upsert all 51 crops into gaez_crops table (keep as reference)
  for (const crop of catalogData.crops) {
    const stats = crop.code === 'brl' ? barleyStats : {};
    await upsertGaezCrop({
      ...crop,
      summary_stats: stats
    });
  }
  console.log(`Seeded ${catalogData.crops.length} GAEZ v4 crops in table gaez_crops.`);

  // 3. Read current plants.json (the 8 hand-curated crops)
  const plantsData = JSON.parse(await fs.readFile(plantsJsonPath, 'utf8'));
  const existingGaezCodes = new Set(
    plantsData.crops.map((c) => c.gaez_code).filter(Boolean)
  );

  // 4. Upsert the 8 hand-curated plants (they have richer data)
  for (const crop of plantsData.crops) {
    await upsertPlant(crop, crop.faostat_item || null, crop.faostat_stats || {});
  }
  console.log(`Synchronized ${plantsData.crops.length} hand-curated plants into PostgreSQL.`);

  // 5. Upsert the remaining GAEZ crops (not already in plants.json) into the plants table
  let gaezOnlyCount = 0;
  for (const gaezCrop of catalogData.crops) {
    if (existingGaezCodes.has(gaezCrop.code)) {
      // Already covered by richer plants.json data — skip
      continue;
    }
    const stats = gaezCrop.code === 'brl' ? barleyStats : {};
    const plantEntry = gaezToPlant(gaezCrop, stats);
    await upsertPlant(plantEntry, null, {});
    gaezOnlyCount++;
  }
  console.log(`Inserted ${gaezOnlyCount} additional GAEZ crops into plants table.`);
  console.log(`Total plants table now has ${plantsData.crops.length + gaezOnlyCount} crops (8 curated + ${gaezOnlyCount} from GAEZ).`);
}

export { seedGaez };

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  seedGaez()
    .then(() => console.log('GAEZ data successfully seeded into database.'))
    .catch((err) => {
      console.error('Failed to seed GAEZ data:', err);
      process.exitCode = 1;
    })
    .finally(close);
}
