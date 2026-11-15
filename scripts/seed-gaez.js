import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { close, migrate, upsertGaezCrop, upsertPlant } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catalogPath = path.join(__dirname, '..', 'data', 'gaez_crops_catalog.json');
const barleySummaryPath = path.join(__dirname, '..', 'data', 'gaez_barley_summary.json');
const plantsJsonPath = path.join(__dirname, '..', 'plants.json');

async function seedGaez() {
  await migrate();
  console.log('PostgreSQL migrations applied.');

  // 1. Read GAEZ 51 crops catalog
  const catalogData = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
  let barleyStats = {};

  try {
    barleyStats = JSON.parse(await fs.readFile(barleySummaryPath, 'utf8'));
    console.log('Loaded extracted Barley GAEZ CSV summary for Angola basins.');
  } catch {
    console.warn('Barley summary not found; proceeding with catalog metadata.');
  }

  // 2. Upsert all 51 crops into gaez_crops
  for (const crop of catalogData.crops) {
    const stats = crop.code === 'brl' ? barleyStats : {};
    await upsertGaezCrop({
      ...crop,
      summary_stats: stats
    });
  }
  console.log(`Seeded ${catalogData.crops.length} GAEZ v4 crops in table gaez_crops.`);

  // 3. Update plants.json with GAEZ codes and add Barley (Cevada)
  const plantsData = JSON.parse(await fs.readFile(plantsJsonPath, 'utf8'));
  const gaezCodeMap = {
    milho: 'mze',
    feijao_macunde: 'cow',
    feijao_vulgar: 'phb',
    mandioca: 'csv',
    ginguba: 'grd',
    massambala: 'srg',
    batata_doce: 'spo'
  };

  plantsData.crops = plantsData.crops.map((crop) => {
    if (gaezCodeMap[crop.id]) {
      return {
        ...crop,
        gaez_code: gaezCodeMap[crop.id]
      };
    }
    return crop;
  });

  // Check if cevada (barley) already exists in plants.json
  const hasBarley = plantsData.crops.some((c) => c.id === 'cevada');
  if (!hasBarley) {
    const barleyPlant = {
      id: 'cevada',
      name_pt: 'Cevada',
      scientific_name: 'Hordeum vulgare',
      botanical_family: 'Poaceae',
      role_in_rotation: 'Cereal de Altitude / Ciclo Frio',
      nitrogen_impact: 'Extrator moderado',
      nitrogen_fixation_kg_ha: 0,
      climate_requirements: {
        temp_min_c: 5.0,
        temp_optimal_min_c: 15.0,
        temp_optimal_max_c: 20.0,
        temp_max_stress_c: 30.0,
        water_need_mm_min: 350,
        water_need_mm_max: 500,
        drought_tolerance: 'Média-Alta (superior ao trigo)'
      },
      soil_requirements: {
        ph_min: 6.0,
        ph_max: 7.5,
        preferred_texture: ['Franco', 'Franco-argiloso'],
        erosion_protection: 'Média'
      },
      angola_calendar: {
        cycle_days: 110,
        planting_months: [4, 5],
        harvest_months: [8, 9]
      },
      good_successors: ['feijao_vulgar', 'soja', 'feijao_macunde'],
      pest_risk_if_monoculture: ['Oídio', 'Helmintosporiose'],
      gaez_code: 'brl',
      gaez_stats: barleyStats
    };

    plantsData.crops.push(barleyPlant);
  }

  await fs.writeFile(plantsJsonPath, JSON.stringify(plantsData, null, 2), 'utf8');
  console.log('Updated plants.json with GAEZ codes and Barley entry.');

  // 4. Upsert plants into PostgreSQL
  for (const crop of plantsData.crops) {
    await upsertPlant(crop, crop.faostat_item || null, crop.faostat_stats || {});
  }
  console.log(`Synchronized ${plantsData.crops.length} plants into PostgreSQL.`);
}

seedGaez()
  .then(() => console.log('GAEZ data successfully seeded into database.'))
  .catch((err) => {
    console.error('Failed to seed GAEZ data:', err);
    process.exitCode = 1;
  })
  .finally(close);
