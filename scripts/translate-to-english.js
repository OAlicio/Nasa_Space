import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Drought tolerance translations ──
const droughtMap = {
  'Muito Baixa': 'Very Low',
  'Baixa': 'Low',
  'Baixa (sensível ao défice hídrico)': 'Low (sensitive to water deficit)',
  'Baixa (sensível na floração)': 'Low (sensitive during flowering)',
  'Baixa-Média': 'Low-Medium',
  'Média-Baixa': 'Low-Medium',
  'Média': 'Medium',
  'Média-Alta': 'Medium-High',
  'Média-Alta (superior ao trigo)': 'Medium-High (superior to wheat)',
  'Alta': 'High',
  'Alta (solos ácidos e frios)': 'High (acidic and cold soils)',
  'Muito Alta': 'Very High',
  'Muito Alta (sobrevive ao cacimbo)': 'Very High (survives dry season)',
  'Extrema (o mais tolerante dos cereais)': 'Extreme (most tolerant cereal)',
};

// ── Crop group translations ──
const groupMap = {
  'Açucareira / Perene': 'Sugar / Perennial',
  'Açucareira / Raiz': 'Sugar / Root',
  'Bioenergia / Biomassa': 'Bioenergy / Biomass',
  'Bioenergia / Forragem': 'Bioenergy / Forage',
  'Bioenergia / Gramínea': 'Bioenergy / Grass',
  'Bioenergia / Perene': 'Bioenergy / Perennial',
  'Cereal': 'Cereal',
  'Fibra / Industrial': 'Fiber / Industrial',
  'Fibra / Oleaginosa': 'Fiber / Oilseed',
  'Forragem': 'Forage',
  'Forragem / Biomassa': 'Forage / Biomass',
  'Forragem / Leguminosa': 'Forage / Legume',
  'Fruta / Perene': 'Fruit / Perennial',
  'Hortícola': 'Horticultural',
  'Hortícola de raiz': 'Root Vegetable',
  'Industrial': 'Industrial',
  'Industrial / Perene': 'Industrial / Perennial',
  'Leguminosa / Grão': 'Legume / Grain',
  'Leguminosa / Oleaginosa': 'Legume / Oilseed',
  'Leguminosa / Semi-perene': 'Legume / Semi-perennial',
  'Oleaginosa': 'Oilseed',
  'Oleaginosa / Leguminosa': 'Oilseed / Legume',
  'Oleaginosa / Perene': 'Oilseed / Perennial',
  'Pseudocereal': 'Pseudocereal',
  'Tubérculo / Raiz': 'Tuber / Root',
};

// ── Angola relevance translations (per crop code) ──
const relevanceMap = {
  'alf': 'Animal forage and cereal rotation crop',
  'ban': 'Very common commercial and food crop (Bengo, Cuanza Sul)',
  'bck': 'Cover crop and cycle break',
  'brl': 'Suited to highland zones (Central Plateau) in the dry/cool season',
  'bsg': 'Drought-resistant in southern Angola',
  'cab': 'Peri-urban horticulture and green belts',
  'car': 'Commercial horticulture on the plateau',
  'chk': 'Nitrogen fixer for semi-arid soils',
  'cit': 'Commercial perennial production (Cuanza Sul, Benguela)',
  'coc': 'Cabinda and humid northern Angola',
  'cof': 'Robusta coffee (Uíge, Cuanza Norte, Cuanza Sul) historically important in Angola',
  'con': 'Tropical coastal strip',
  'cot': 'Historic crop in the Baixa de Cassanje (Malanje)',
  'cow': 'Staple subsistence crop and nitrogen fixer across the country',
  'csv': 'Main caloric food base of Angola',
  'flx': 'High-altitude temperate zones',
  'fml': 'Resilient secondary cereal for poor soils',
  'grd': 'Key crop for rotation and commercial yield in sandy soils',
  'grm': 'Ultra-short cycle and nitrogen fixer',
  'jtr': 'Living hedge crop against erosion in semi-arid areas',
  'mis': 'Slope erosion protection',
  'mze': 'Main crop on the Central Plateau (Huambo, Bié, Huíla)',
  'mzs': 'Cattle feed',
  'nap': 'Erosion retention strips and forage on the plateau',
  'oat': 'Cover crop and high-altitude forage',
  'olp': 'Palm oil in tropical north (Cabinda, Zaire, Uíge)',
  'olv': 'Mediterranean / arid climate',
  'oni': 'Irrigated horticulture in Cavaco valley and plateau',
  'pea': 'Nitrogen fixer in high-altitude zones',
  'phb': 'Second most cultivated legume in Angola (Huambo, Uíge, Bié)',
  'pig': 'Excellent nitrogen fixer and degraded soil regenerator',
  'pml': 'Fundamental crop in the semi-arid south (Cunene, Namibe, Huíla)',
  'rcd': 'Malanje, Lunda Norte, Moxico, Uíge',
  'rcg': 'Riverbank and wet floodplain stabilization',
  'rcw': 'Irrigated perimeters and wet lowlands (Cuando Cubango, Moxico)',
  'rsd': 'Plateau in winter/dry season',
  'rub': 'Northern forested Angola',
  'rye': 'Altitudes above 1700 m in Huambo',
  'sfl': 'Excellent rotation break and vegetable oil production',
  'soy': 'Major commercial rotation with maize (Malanje, Cuanza Sul, Huambo)',
  'spo': 'Fast ground cover against erosion and food security',
  'srg': 'Direct maize substitute in dry years and southern regions',
  'sub': 'Temperate climates',
  'suc': 'Large agro-industrial hubs (Capanda, Bengo)',
  'swg': 'Severe slope erosion control',
  'tea': 'Humid mountainous regions (Cuanza Sul)',
  'tob': 'Secondary commercial crop',
  'tom': 'Main quick-yield vegetable in Angola (Benguela, Cuanza Sul)',
  'whe': 'Winter/dry season crop on the Central Plateau (Huambo and Bié)',
  'wpo': 'High-yield crop on the plateau (Huambo)',
  'yam': 'Traditional food in northern Angola',
};

// ── Translate a drought_tolerance string ──
function translateDrought(pt) {
  if (!pt) return pt;
  return droughtMap[pt] || pt;
}

// ── Translate a crop_group string ──
function translateGroup(pt) {
  if (!pt) return pt;
  return groupMap[pt] || pt;
}

async function main() {
  // 1. Translate gaez_crops_catalog.json
  const catalogPath = path.join(__dirname, '..', 'data', 'gaez_crops_catalog.json');
  const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));

  for (const crop of catalog.crops) {
    crop.drought_tolerance = translateDrought(crop.drought_tolerance);
    crop.crop_group = translateGroup(crop.crop_group);
    crop.angola_relevance = relevanceMap[crop.code] || crop.angola_relevance;
    crop.name_pt = crop.name_en;
  }

  await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  console.log(`Translated ${catalog.crops.length} crops in gaez_crops_catalog.json`);

  // 2. Translate plants.json
  const plantsPath = path.join(__dirname, '..', 'plants.json');
  const plants = JSON.parse(await fs.readFile(plantsPath, 'utf8'));

  for (const crop of plants.crops) {
    if (crop.climate_requirements?.drought_tolerance) {
      crop.climate_requirements.drought_tolerance = translateDrought(crop.climate_requirements.drought_tolerance);
    }
    crop.name_pt = crop.name_en;
    if (crop.gaez_stats?.crop_name_en) {
      crop.gaez_stats.crop_name_pt = crop.gaez_stats.crop_name_en;
    }
  }

  await fs.writeFile(plantsPath, JSON.stringify(plants, null, 2) + '\n', 'utf8');
  console.log(`Translated ${plants.crops.length} crops in plants.json`);

  const barleySummaryPath = path.join(__dirname, '..', 'data', 'gaez_barley_summary.json');
  const barleySummary = JSON.parse(await fs.readFile(barleySummaryPath, 'utf8'));
  barleySummary.crop_name_pt = barleySummary.crop_name_en;
  await fs.writeFile(barleySummaryPath, JSON.stringify(barleySummary, null, 2) + '\n', 'utf8');

  console.log('\nDone! Now run: npm run db:seed:gaez');
}

main().catch(console.error);
