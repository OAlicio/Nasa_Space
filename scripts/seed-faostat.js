import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { close, migrate, upsertPlant } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiUrl = process.env.FAOSTAT_API_URL || 'https://fenixservices.fao.org/api/faostat/data/v1/en/QCL';
const cropsPath = path.join(__dirname, '..', 'plants.json');

const faostatNames = {
  milho: 'Maize (corn)',
  feijao_macunde: 'Cow peas, dry',
  feijao_vulgar: 'Beans, dry',
  mandioca: 'Cassava, fresh',
  ginguba: 'Groundnuts, excluding shelled',
  massambala: 'Sorghum',
  batata_doce: 'Sweet potatoes',
  cevada: 'Barley'
};

async function fetchFaostat(item) {
  const url = new URL(apiUrl);
  url.search = new URLSearchParams({
    area_code: '7',
    item: faostatNames[item] || item,
    page_size: '100'
  });

  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`FAOSTAT responded with ${response.status}`);
  const payload = await response.json();
  return payload.data || payload || [];
}

function summarise(rows) {
  return rows.reduce((stats, row) => {
    const element = String(row.Element || row.element || '').toLowerCase();
    const value = Number(row.Value ?? row.value);
    if (!Number.isFinite(value)) return stats;
    if (element.includes('production')) stats.production_tonnes = value;
    if (element.includes('yield')) stats.yield = value;
    if (element.includes('area harvested')) stats.area_harvested_ha = value;
    stats.year = row.Year || row.year || stats.year;
    stats.unit = row.Unit || row.unit || stats.unit;
    return stats;
  }, {});
}

async function seed() {
  await migrate();
  const { crops } = JSON.parse(await fs.readFile(cropsPath, 'utf8'));

  for (const crop of crops) {
    let stats = {};
    try {
      stats = summarise(await fetchFaostat(crop.id));
      console.log(`${crop.id}: FAOSTAT data successfully imported`);
    } catch (error) {
      console.warn(`${crop.id}: FAOSTAT unavailable (${error.message}); preserving catalog data`);
    }
    await upsertPlant(crop, faostatNames[crop.id], stats);
  }
}

seed()
  .then(() => console.log('Plant catalog seeded in PostgreSQL.'))
  .catch((error) => {
    console.error('Could not seed PostgreSQL:', error);
    process.exitCode = 1;
  })
  .finally(close);
