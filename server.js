const express = require('express');
const path = require('node:path');
const { listPlants, migrate } = require('./db');

const app = express();
const port = process.env.PORT || 3000;
let plants = { crops: [] };
const analysisCache = new Map();
const powerCache = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function numberInRange(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function dateString(date) { return date.toISOString().slice(0, 10).replaceAll('-', ''); }

function cacheKey(latitude, longitude) { return `${latitude.toFixed(2)},${longitude.toFixed(2)}`; }

function normaliseRequest(body = {}) {
  const latitude = numberInRange(body.latitude, -18.5, -4.3, -8.84);
  const longitude = numberInRange(body.longitude, 11.6, 24.1, 13.23);
  const seasons = Math.round(numberInRange(body.seasons, 1, 3, 2));
  return {
    latitude,
    longitude,
    polygon: Array.isArray(body.polygon) ? body.polygon : [],
    areaHa: Number.isFinite(Number(body.areaHa)) ? Number(body.areaHa) : 1.2,
    currentCrop: body.currentCrop || '',
    currentPlantingDate: body.currentPlantingDate || '',
    usualCrop: body.usualCrop || 'Não sei',
    irrigation: body.irrigation === true || body.irrigation === 'true' ? 'Sim' : 'Não',
    soil: body.soil || 'Franco-arenoso',
    primaryGoal: body.primaryGoal || 'saude_solo',
    secondaryGoal: body.secondaryGoal || '',
    seasons
  };
}

function buildRecommendation(climate, crop) {
  const tempFit = climate.averageTemperature >= crop.climate_requirements.temp_optimal_min_c && climate.averageTemperature <= crop.climate_requirements.temp_optimal_max_c;
  const waterFit = climate.totalRainfall >= crop.climate_requirements.water_need_mm_min;
  const droughtBonus = crop.climate_requirements.drought_tolerance.includes('Alta') ? 12 : 0;
  const score = Math.round(Math.min(100, 42 + (tempFit ? 30 : 8) + (waterFit ? 18 : 0) + droughtBonus));
  const reasons = [tempFit ? 'temperatura dentro da faixa ideal' : 'temperatura fora da faixa ideal', waterFit ? 'chuva acumulada cobre a necessidade mínima' : 'pode exigir irrigação suplementar'];
  if (crop.nitrogen_fixation_kg_ha > 0)
    reasons.push(`fixa até ${crop.nitrogen_fixation_kg_ha} kg/ha de azoto`);
  return { id: crop.id, name: crop.name_pt, score, role: crop.role_in_rotation, waterNeed: `${crop.climate_requirements.water_need_mm_min}-${crop.climate_requirements.water_need_mm_max} mm`, nitrogenFixation: crop.nitrogen_fixation_kg_ha, reasons, droughtTolerance: crop.climate_requirements.drought_tolerance };
}

function goalWeights(goal) {
  return {
    agua: { water: .45, soil: .2, erosion: .15, market: .2 },
    erosao: { water: .15, soil: .25, erosion: .45, market: .15 },
    rendimento: { water: .2, soil: .15, erosion: .1, market: .55 },
    saude_solo: { water: .15, soil: .5, erosion: .25, market: .1 },
    materia_organica: { water: .15, soil: .5, erosion: .25, market: .1 }
  }[goal] || { water: .25, soil: .25, erosion: .25, market: .25 };
}

function scoreCrop(crop, climate, request, position) {
  const weights = goalWeights(request.primaryGoal);
  const water = crop.climate_requirements.water_need_mm_min <= climate.totalRainfall ? 1 : .45;
  const soil = request.soil.includes('arenoso') && crop.soil_requirements.preferred_texture.some((item) => item.includes('arenoso')) ? 1 : .65;
  const erosion = crop.soil_requirements.erosion_protection.includes('Alta') || crop.soil_requirements.erosion_protection.includes('Muito') ? .95 : .55;
  const market = crop.role_in_rotation.includes('Rendimento') ? 1 : .65;
  const irrigationBonus = request.irrigation === 'Sim' ? .08 : 0;
  const score = Math.round(Math.min(1, water * weights.water + soil * weights.soil + erosion * weights.erosion + market * weights.market + irrigationBonus) * 100);
  return { score, water, soil, erosion, position };
}

function buildStrategies(climate, request) {
  const referenceId = request.currentCrop || request.usualCrop;
  const reference = plants.crops.find((crop) => crop.id === referenceId) || plants.crops[0];
  const sorted = plants.crops.map((crop) => ({ crop, rating: scoreCrop(crop, climate, request, 0) }))
    .filter(({ crop }) => crop.id !== reference.id)
    .sort((a, b) => b.rating.score - a.rating.score);
  const choices = [reference, sorted[0]?.crop || plants.crops[1], sorted[1]?.crop || plants.crops[2]];
  return choices.map((crop, index) => {
    const rating = scoreCrop(crop, climate, request, index);
    const sequence = Array.from({ length: request.seasons }, (_, season) => {
      if (index === 0) return crop.name_pt;
      const candidate = plants.crops.find((item) => item.botanical_family !== crop.botanical_family && item.id !== crop.id && (season > 0 || item.nitrogen_fixation_kg_ha > 0));
      return season === 0 ? crop.name_pt : (candidate || crop).name_pt;
    });
    const isReference = index === 0;
    return {
      id: `strategy-${String.fromCharCode(65 + index)}`,
      label: `Estratégia ${String.fromCharCode(65 + index)}`,
      title: isReference ? 'Rotação atual / referência' : index === 1 ? 'Solo vivo e resiliência' : 'Poupança de água',
      sequence,
      score: rating.score,
      confidence: rating.score > 70 ? 'Média' : 'Baixa',
      why: isReference ? 'Mantém a prática indicada pelo agricultor para servir de comparação.' : `Combina ${crop.name_pt} com culturas de outra família e uma cultura fixadora de azoto.`,
      evidence: [`NASA POWER: ${climate.totalRainfall} mm de chuva nos últimos 30 dias`, `Catálogo Field Shift: ciclo de ${crop.angola_calendar.cycle_days} dias`, `Objetivo: ${request.primaryGoal.replaceAll('_', ' ')}`],
      benefits: [crop.role_in_rotation, `${crop.nitrogen_fixation_kg_ha} kg/ha de fixação de azoto`],
      gaps: ['Tipo de solo indicado pelo agricultor', 'Calendário local ainda não validado'],
      risks: [rating.water < .7 ? 'Pode exigir rega suplementar' : 'Chuva próxima da necessidade mínima', 'Validar pragas e disponibilidade de sementes localmente']
    };
  }).sort((a, b) => b.score - a.score);
}

function buildIndicators(climate) {
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const base = climate.totalRainfall / 30;
  return {
    rainfall: months.map((month, index) => ({ month, value: Number((base * (0.65 + ((index * 17) % 70) / 100)).toFixed(1)), normal: Number((base * 1.1).toFixed(1)) })),
    wetSeasonStart: 'Outubro (estimativa regional)',
    dryPeriods: climate.totalRainfall < 80 ? 3 : 1,
    soilMoisture: climate.averageHumidity,
    bareSoilPeriods: 2,
    note: 'Séries históricas completas e NDVI MODIS serão ligados ao cache de dados quando o serviço ORNL estiver configurado.'
  };
}

function buildAnalysis(climate, request, source = 'NASA POWER') {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    version: 1,
    request,
    climate: { ...climate, source },
    indicators: buildIndicators(climate),
    strategies: buildStrategies(climate, request),
    premises: [
      { key: 'soil', label: 'Tipo de solo', value: request.soil, source: 'Agricultor', status: 'por validar' },
      { key: 'irrigation', label: 'Acesso a rega', value: request.irrigation, source: 'Agricultor', status: 'por validar' },
      { key: 'seeds', label: 'Sementes disponíveis', value: 'A confirmar localmente', source: 'Agricultor', status: 'por validar' },
      { key: 'calendar', label: 'Calendário local de plantio', value: 'Referência regional', source: 'Literatura', status: 'por validar' }
    ],
    metadata: { sources: ['NASA POWER', 'Catálogo Field Shift'], resolution: 'POWER: cerca de 50 km; NDVI: não disponível no MVP', limitations: ['Não é previsão meteorológica', 'A chuva representa uma célula aproximada de 50 km'] }
  };
}

async function fetchPower(latitude, longitude) {
  const key = cacheKey(latitude, longitude);
  if (powerCache.has(key)) return { ...powerCache.get(key), cached: true };
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 30);
  const url = new URL('https://power.larc.nasa.gov/api/temporal/daily/point');
  url.search = new URLSearchParams({ parameters: 'T2M,PRECTOTCORR,ALLSKY_SFC_SW_DWN,RH2M', community: 'AG', longitude: String(longitude), latitude: String(latitude), start: dateString(start), end: dateString(end), format: 'JSON' });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`NASA POWER responded with ${response.status}`);
  const payload = await response.json();
  const values = payload.properties?.parameter || {};
  const valid = (series) => Object.values(series || {}).filter((value) => Number.isFinite(value) && value > -900);
  const average = (series) => { const items = valid(series); return items.length ? items.reduce((sum, value) => sum + value, 0) / items.length : 0; };
  const sum = (series) => valid(series).reduce((total, value) => total + value, 0);
  const result = { source: 'NASA POWER', period: `${start.toISOString().slice(0, 10)} a ${end.toISOString().slice(0, 10)}`, averageTemperature: Number(average(values.T2M).toFixed(1)), totalRainfall: Number(sum(values.PRECTOTCORR).toFixed(1)), averageRadiation: Number(average(values.ALLSKY_SFC_SW_DWN).toFixed(1)), averageHumidity: Number(average(values.RH2M).toFixed(1)), coordinates: { latitude, longitude } };
  powerCache.set(key, result);
  return result;
}

app.get('/api/crops', (req, res) => res.json(plants));

app.get('/api/climate', async (req, res) => {
  const latitude = numberInRange(req.query.latitude, -18.5, -4.3, -8.84);
  const longitude = numberInRange(req.query.longitude, 11.6, 24.1, 13.23);
  try { res.json(await fetchPower(latitude, longitude)); } catch (error) { res.status(502).json({ error: 'Não foi possível consultar a NASA POWER agora.', detail: error.message }); }
});

app.get('/api/recommendations', async (req, res) => {
  const latitude = numberInRange(req.query.latitude, -18.5, -4.3, -8.84);
  const longitude = numberInRange(req.query.longitude, 11.6, 24.1, 13.23);
  try {
    const climate = await fetchPower(latitude, longitude);
    const recommendations = plants.crops.map((crop) => buildRecommendation(climate, crop)).sort((a, b) => b.score - a.score);
    res.json({ climate, recommendations });
  } catch (error) { res.status(502).json({ error: 'Não foi possível gerar recomendações com os dados NASA.', detail: error.message }); }
});

app.post('/api/analyses', async (req, res) => {
  const request = normaliseRequest(req.body);
  try {
    const climate = await fetchPower(request.latitude, request.longitude);
    const analysis = buildAnalysis(climate, request);
    analysisCache.set(analysis.id, analysis);
    res.status(201).json(analysis);
  } catch (error) {
    res.status(502).json({ error: 'Não foi possível gerar a análise com os dados NASA.', detail: error.message });
  }
});

app.patch('/api/analyses/:id/premises', (req, res) => {
  const analysis = analysisCache.get(req.params.id);
  if (!analysis) return res.status(404).json({ error: 'Análise não encontrada.' });
  const request = { ...analysis.request, ...req.body };
  const updated = buildAnalysis(analysis.climate, request, analysis.climate.source);
  updated.id = analysis.id;
  updated.version = analysis.version + 1;
  updated.premises = updated.premises.map((premise) => premise.key === 'soil' && request.soil ? { ...premise, value: request.soil, status: 'validada' } : premise);
  analysisCache.set(updated.id, updated);
  res.json(updated);
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
async function start() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não está configurada. Consulte o README para instalar e configurar PostgreSQL.');
  await migrate();
  plants = await listPlants();
  if (!plants.crops.length) throw new Error('A tabela plants está vazia. Execute npm run db:seed.');
  app.listen(port, () => console.log(`Field Shift running at http://localhost:${port}`));
}

start().catch((error) => {
  console.error(`Não foi possível iniciar o Field Shift: ${error.message}`);
  process.exitCode = 1;
});