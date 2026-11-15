import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { close, migrate, upsertGaezCrop, upsertPlant } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const catalogPath = path.join(__dirname, '..', 'data', 'gaez_crops_catalog.json');
const barleySummaryPath = path.join(__dirname, '..', 'data', 'gaez_barley_summary.json');
const plantsJsonPath = path.join(__dirname, '..', 'plants.json');

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

  // 2. Upsert all 51 crops into gaez_crops table
  for (const crop of catalogData.crops) {
    const stats = crop.code === 'brl' ? barleyStats : {};
    await upsertGaezCrop({
      ...crop,
      summary_stats: stats
    });
  }
  console.log(`Seeded ${catalogData.crops.length} GAEZ v4 crops in table gaez_crops.`);

  // 3. Read current plants.json and synchronize with PostgreSQL
  const plantsData = JSON.parse(await fs.readFile(plantsJsonPath, 'utf8'));

  for (const crop of plantsData.crops) {
    await upsertPlant(crop, crop.faostat_item || null, crop.faostat_stats || {});
  }
  console.log(`Synchronized ${plantsData.crops.length} plants into PostgreSQL.`);
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
