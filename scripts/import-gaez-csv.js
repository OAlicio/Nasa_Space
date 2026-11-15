import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { createReadStream } from 'node:fs';

const SOURCE_DIR = process.env.GAEZ_CSV_DIR || '/home/ofeverei/sgoinfre/brl_hy0_High_ENSEMBLE';
const OUTPUT_FILE = path.join(process.cwd(), 'data', 'gaez_barley_summary.json');

const ANGOLA_BASINS = {
  '7023': 'Angola, Coast',
  '7005': 'Congo',
  '7006': 'Zambezi'
};

async function parseCsvFile(filePath) {
  const fileName = path.basename(filePath);
  const parts = fileName.replace('.csv', '').split('_');
  const crop = parts[0];
  const model = parts[1];
  const rcp = parts[2];
  const horizonSpec = parts[3];

  const horizon = horizonSpec.slice(0, 5);
  const waterSupply = horizonSpec.includes('Hi') ? 'irrigated' : 'rainfed';
  const co2Fertilization = !horizonSpec.endsWith('0');

  const fileStream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let header = null;
  let hyd0Idx = -1;
  let lcIdx = -1;
  let excIdx = -1;
  let aezIdx = -1;
  let vsIdx = -1;
  let sIdx = -1;
  let msIdx = -1;
  let nsIdx = -1;
  let ymaxIdx = -1;
  let wdIdx = -1;

  const recordsByBasin = {};

  for await (const line of rl) {
    if (!line.trim()) continue;
    // Basic CSV splitting (handling quoted fields)
    const row = line.match(/(?:[^\s,"]+|"[^"]*")+/g) || [];
    if (!header) {
      header = row.map((h) => h.replace(/"/g, '').trim());
      hyd0Idx = header.indexOf('HYD0');
      lcIdx = header.indexOf('LC');
      excIdx = header.indexOf('EXC');
      aezIdx = header.indexOf('AEZ');
      vsIdx = header.indexOf('SUIT_VS');
      sIdx = header.indexOf('SUIT_S');
      msIdx = header.indexOf('SUIT_MS');
      nsIdx = header.indexOf('SUIT_NS');
      ymaxIdx = header.indexOf('Ymax');
      wdIdx = header.indexOf('wd_VS');
      continue;
    }

    const hyd0 = row[hyd0Idx]?.replace(/"/g, '').trim();
    if (ANGOLA_BASINS[hyd0]) {
      const basinName = ANGOLA_BASINS[hyd0];
      const lc = row[lcIdx]?.replace(/"/g, '').trim();
      const exc = row[excIdx]?.replace(/"/g, '').trim();

      // Total land summary row (LC=11, EXC=5)
      if (lc === '11' && exc === '5') {
        const vs = parseFloat(row[vsIdx]) || 0;
        const s = parseFloat(row[sIdx]) || 0;
        const ms = parseFloat(row[msIdx]) || 0;
        const ns = parseFloat(row[nsIdx]) || 0;
        const ymax = parseFloat(row[ymaxIdx]) || 0;
        const wd = parseFloat(row[wdIdx]) || 0;

        recordsByBasin[basinName] = {
          basin_id: hyd0,
          basin_name: basinName,
          crop,
          climate_model: model,
          rcp,
          horizon,
          water_supply: waterSupply,
          co2_fertilization: co2Fertilization,
          ymax_kg_ha: ymax,
          water_deficit_or_irrigation_mm: wd > 0 ? wd : null,
          suitability_km2: {
            very_suitable: Math.round(vs * 100) / 100,
            suitable: Math.round(s * 100) / 100,
            moderately_suitable: Math.round(ms * 100) / 100,
            not_suitable: Math.round(ns * 100) / 100,
            total_suitable: Math.round((vs + s + ms) * 100) / 100
          }
        };
      }
    }
  }

  return recordsByBasin;
}

async function main() {
  console.log(`Reading GAEZ CSV directory: ${SOURCE_DIR}`);
  const files = (await fs.readdir(SOURCE_DIR))
    .filter((f) => f.endsWith('.csv'))
    .sort();

  console.log(`Found ${files.length} CSV files.`);
  const aggregated = {
    crop: 'brl',
    crop_name_en: 'Barley',
    crop_name_pt: 'Cevada',
    scientific_name: 'Hordeum vulgare',
    source: 'FAO GAEZ v4 (brl_hy0_High_ENSEMBLE)',
    basins: {
      'Angola, Coast': [],
      'Congo': [],
      'Zambezi': []
    }
  };

  for (const file of files) {
    const filePath = path.join(SOURCE_DIR, file);
    const records = await parseCsvFile(filePath);
    for (const [basinName, rec] of Object.entries(records)) {
      if (aggregated.basins[basinName]) {
        aggregated.basins[basinName].push(rec);
      }
    }
  }

  await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(aggregated, null, 2), 'utf8');
  console.log(`Successfully generated ${OUTPUT_FILE}`);
}

main().catch((err) => {
  console.error('Error importing GAEZ CSV files:', err);
  process.exit(1);
});
