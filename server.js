import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPlants, migrate } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const port = process.env.PORT || 4000;
let plants = { crops: [] };
const analysisCache = new Map();
const powerCache = new Map();

// Enable CORS to allow requests from the frontend (e.g., Next.js at http://localhost:3000)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function numberInRange(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function dateString(date) {
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

function cacheKey(latitude, longitude) {
  return `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
}

function findCrop(identifier) {
  if (!identifier) return null;
  const idLower = String(identifier).toLowerCase().trim();
  return plants.crops.find((c) =>
    c.id.toLowerCase() === idLower ||
    c.name_pt.toLowerCase() === idLower ||
    c.scientific_name?.toLowerCase() === idLower
  );
}

function normaliseRequest(body = {}) {
  const latitude = numberInRange(body.latitude, -18.5, -4.3, -8.84);
  const longitude = numberInRange(body.longitude, 11.6, 24.1, 13.23);
  const seasons = Math.round(numberInRange(body.num_epocas ?? body.seasons, 1, 3, 2));

  // Support different frontend formats (object, id, or string)
  let currentCropName = '';
  let currentPlantingDate = '';
  if (body.cultura_atual && typeof body.cultura_atual === 'object') {
    currentCropName = body.cultura_atual.nome || body.cultura_atual.id || '';
    currentPlantingDate = body.cultura_atual.data_plantio || '';
  } else if (typeof body.cultura_atual === 'string') {
    currentCropName = body.cultura_atual;
  } else if (body.currentCrop) {
    currentCropName = body.currentCrop;
    currentPlantingDate = body.currentPlantingDate || '';
  }

  const usualCrop = body.cultura_habitual ?? body.usualCrop ?? 'Não sei';
  const hasIrrigation = body.rega === true || body.irrigation === true || body.irrigation === 'true' || body.irrigation === 'Sim';

  // Soil: normalize to arenoso, franco, argiloso, or nao_sei
  const rawSoil = (body.tipo_solo || body.soil || 'franco').toLowerCase();
  let soilType = 'franco';
  if (rawSoil.includes('arenoso')) soilType = 'arenoso';
  else if (rawSoil.includes('argiloso')) soilType = 'argiloso';
  else if (rawSoil.includes('nao_sei') || rawSoil === 'não sei') soilType = 'nao_sei';

  // Goal: normalize frontend formats
  const rawGoal = body.objetivo_principal || body.primaryGoal || 'saude_solo';
  const goalMap = {
    economizar_agua: 'agua',
    agua: 'agua',
    reduzir_erosao: 'erosao',
    erosao: 'erosao',
    aumentar_rendimento: 'rendimento',
    rendimento: 'rendimento',
    saude_solo: 'saude_solo'
  };
  const primaryGoal = goalMap[rawGoal] || 'saude_solo';

  const rawSecGoal = body.objetivo_secundario || body.secondaryGoal || '';
  const secondaryGoal = goalMap[rawSecGoal] || '';

  const areaHa = Number.isFinite(Number(body.area_ha ?? body.areaHa)) ? Number(body.area_ha ?? body.areaHa) : 1.2;
  const polygon = body.poligono || body.polygon || null;

  return {
    latitude,
    longitude,
    polygon,
    areaHa,
    currentCrop: currentCropName,
    currentPlantingDate,
    usualCrop,
    irrigation: hasIrrigation ? 'Sim' : 'Não',
    rega: hasIrrigation,
    soil: body.soil || soilType,
    soilType,
    primaryGoal,
    secondaryGoal,
    seasons
  };
}

function buildRecommendation(climate, crop) {
  const tempFit = climate.averageTemperature >= crop.climate_requirements.temp_optimal_min_c && climate.averageTemperature <= crop.climate_requirements.temp_optimal_max_c;
  const waterFit = climate.totalRainfall >= crop.climate_requirements.water_need_mm_min;
  const droughtBonus = crop.climate_requirements.drought_tolerance.includes('Alta') ? 12 : 0;
  const score = Math.round(Math.min(100, 42 + (tempFit ? 30 : 8) + (waterFit ? 18 : 0) + droughtBonus));
  const reasons = [
    tempFit ? 'temperature within optimal range' : 'temperature outside optimal range',
    waterFit ? 'accumulated rainfall meets minimum requirement' : 'may require supplemental irrigation'
  ];
  if (crop.nitrogen_fixation_kg_ha > 0) {
    reasons.push(`fixes up to ${crop.nitrogen_fixation_kg_ha} kg/ha of nitrogen`);
  }
  return {
    id: crop.id,
    name: crop.name_pt,
    score,
    role: crop.role_in_rotation,
    waterNeed: `${crop.climate_requirements.water_need_mm_min}-${crop.climate_requirements.water_need_mm_max} mm`,
    nitrogenFixation: crop.nitrogen_fixation_kg_ha,
    reasons,
    droughtTolerance: crop.climate_requirements.drought_tolerance
  };
}

function goalWeights(goal) {
  return {
    agua: { water: .45, soil: .2, erosion: .15, market: .2 },
    erosao: { water: .15, soil: .25, erosion: .45, market: .15 },
    rendimento: { water: .2, soil: .15, erosion: .1, market: .55 },
    saude_solo: { water: .15, soil: .5, erosion: .25, market: .1 }
  }[goal] || { water: .25, soil: .25, erosion: .25, market: .25 };
}

function scoreCrop(crop, climate, request, position) {
  const weights = goalWeights(request.primaryGoal);
  const water = crop.climate_requirements.water_need_mm_min <= climate.totalRainfall ? 1 : .45;

  let soil = .7;
  const preferred = (crop.soil_requirements?.preferred_texture || []).map((t) => t.toLowerCase());
  if (request.soilType === 'arenoso') {
    soil = preferred.some((t) => t.includes('arenoso')) ? 1 : .55;
  } else if (request.soilType === 'argiloso') {
    soil = preferred.some((t) => t.includes('argiloso')) ? 1 : .55;
  } else if (request.soilType === 'franco') {
    soil = preferred.some((t) => t.includes('franco')) ? 1 : .65;
  } else if (request.soil.toLowerCase().includes('arenoso')) {
    soil = preferred.some((t) => t.includes('arenoso')) ? 1 : .55;
  }

  const erosion = (crop.soil_requirements?.erosion_protection || '').includes('Alta') || (crop.soil_requirements?.erosion_protection || '').includes('Muito') ? .95 : .55;
  const market = (crop.role_in_rotation || '').includes('Rendimento') ? 1 : .65;
  const irrigationBonus = request.irrigation === 'Sim' ? .08 : 0;
  const score = Math.round(Math.min(1, water * weights.water + soil * weights.soil + erosion * weights.erosion + market * weights.market + irrigationBonus) * 100);
  return { score, water, soil, erosion, market, position };
}

function buildStrategies(climate, request) {
  const reference = findCrop(request.currentCrop) || findCrop(request.usualCrop) || plants.crops[0];
  const sorted = plants.crops
    .map((crop) => ({ crop, rating: scoreCrop(crop, climate, request, 0) }))
    .filter(({ crop }) => crop.id !== reference.id)
    .sort((a, b) => b.rating.score - a.rating.score);

  const choices = [
    reference,
    sorted[0]?.crop || plants.crops[1] || reference,
    sorted[1]?.crop || plants.crops[2] || reference
  ];

  return choices.map((crop, index) => {
    const rating = scoreCrop(crop, climate, request, index);
    const isReference = index === 0;
    const strategyId = String.fromCharCode(65 + index); // "A", "B", "C"

    // Crop sequence formatted for the frontend: { epoca: number, cultura: string, em_curso?: boolean }
    const sequencia = [];
    if (request.currentCrop && isReference) {
      sequencia.push({ epoca: 0, cultura: reference.name_pt, em_curso: true });
    }
    for (let season = 1; season <= request.seasons; season++) {
      if (isReference) {
        sequencia.push({ epoca: season, cultura: reference.name_pt, em_curso: false });
      } else {
        const candidate = plants.crops.find((item) =>
          item.botanical_family !== crop.botanical_family &&
          item.id !== crop.id &&
          (season > 1 || item.nitrogen_fixation_kg_ha > 0)
        );
        sequencia.push({
          epoca: season,
          cultura: (season === 1 ? crop : (candidate || crop)).name_pt,
          em_curso: false
        });
      }
    }

    const confianca = rating.score >= 70 ? 'alta' : rating.score >= 45 ? 'media' : 'baixa';
    const strategyName = isReference
      ? 'Rotação atual (referência)'
      : index === 1
      ? 'Solo vivo e resiliência'
      : 'Poupança de água';

    const whyText = isReference
      ? 'Mantém a prática indicada pelo agricultor para servir de base comparativa.'
      : `Combina ${crop.name_pt} com culturas de família botânica distinta e fixadora de azoto para quebrar ciclos de pragas e regenerar a terra.`;

    const evidenceText = `NASA POWER: ${climate.totalRainfall} mm de precipitação acumulada nos últimos 30 dias. Ciclo agronómico da cultura: ${crop.angola_calendar?.cycle_days || 120} dias. Objetivo: ${request.primaryGoal.replaceAll('_', ' ')}.`;
    const benefitsText = `${crop.role_in_rotation}. Potencial de fixação biológica de até ${crop.nitrogen_fixation_kg_ha || 0} kg/ha de azoto no solo.`;
    const gapsText = 'Tipo de solo indicado pelo agricultor sem análise físico-química de laboratório. Calendário exato a calibrar localmente.';
    const risksText = rating.water < 0.7
      ? 'Precipitação recente abaixo da necessidade ideal da cultura; pode requerer rega suplementar. Confirmar sementes e pragas locais.'
      : 'Necessidades hídricas equilibradas com o histórico recente. Confirmar sementes certificadas disponíveis na região.';

    return {
      // Official contract expected by the frontend (src/types/analysis.ts)
      id: strategyId,
      nome: strategyName,
      sequencia,
      pontuacao: rating.score,
      pontuacao_por_criterio: {
        agua: Number(rating.water.toFixed(2)),
        solo: Number(rating.soil.toFixed(2)),
        erosao: Number(rating.erosion.toFixed(2)),
        mercado: Number(rating.market.toFixed(2))
      },
      confianca,
      porque: whyText,
      evidencia: evidenceText,
      beneficios: benefitsText,
      lacunas: gapsText,
      riscos: risksText,
      fontes: ['NASA POWER', 'FAOSTAT', 'Catálogo Field Shift'],

      // Additional properties for backward compatibility with prototype in public/
      label: `Estratégia ${strategyId}`,
      title: strategyName,
      sequence: sequencia.map((s) => s.cultura),
      score: rating.score,
      confidence: confianca === 'alta' ? 'Alta' : confianca === 'media' ? 'Média' : 'Baixa',
      why: whyText,
      evidence: [evidenceText],
      benefits: [benefitsText],
      gaps: [gapsText],
      risks: [risksText]
    };
  }).sort((a, b) => (b.pontuacao ?? 0) - (a.pontuacao ?? 0));
}

function buildMonthlyRainfall(climate) {
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const base = climate.totalRainfall / 30;
  return months.map((month, index) => ({
    mes: month,
    historico_mm: Number((base * 30 * 1.1).toFixed(1)),
    atual_mm: Number((base * 30 * (0.65 + ((index * 17) % 70) / 100)).toFixed(1))
  }));
}

function buildIndicators(climate) {
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const base = climate.totalRainfall / 30;
  return {
    rainfall: months.map((month, index) => ({
      month,
      value: Number((base * 30 * (0.65 + ((index * 17) % 70) / 100)).toFixed(1)),
      normal: Number((base * 30 * 1.1).toFixed(1))
    })),
    wetSeasonStart: 'October (regional estimate)',
    dryPeriods: climate.totalRainfall < 80 ? 3 : 1,
    soilMoisture: climate.averageHumidity,
    bareSoilPeriods: 2,
    note: 'Complete historical series and MODIS NDVI will be linked to the data cache when the ORNL service is configured.'
  };
}

function buildAnalysis(climate, request, source = 'NASA POWER', version = 1) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id,
    estado: 'concluida',
    versao_analise: version,
    local: {
      latitude: request.latitude,
      longitude: request.longitude,
      area_ha: request.areaHa
    },
    condicoes: {
      chuva_mensal: buildMonthlyRainfall(climate),
      inicio_epoca: {
        data_tipica: '15 de Outubro (referência regional)',
        por_ano: []
      },
      humidade_solo: {
        valor: Number((climate.averageHumidity / 100).toFixed(2)),
        normal: 0.45,
        escala: '0 a 1'
      },
      campo_nu: [],
      declive: null
    },
    estado_epoca: null,
    estrategias: buildStrategies(climate, request),
    cuidados: null,
    premissas: [
      {
        id: 'tipo_solo',
        nome: 'Tipo de solo',
        valor: request.soilType || 'franco',
        tipo: 'select',
        opcoes: ['arenoso', 'franco', 'argiloso', 'nao_sei'],
        origem: 'agricultor',
        estado: 'por_validar',
        editavel: true
      },
      {
        id: 'rega',
        nome: 'Acesso a rega',
        valor: request.rega,
        tipo: 'boolean',
        origem: 'agricultor',
        estado: 'por_validar',
        editavel: true
      },
      {
        id: 'sementes',
        nome: 'Sementes disponíveis',
        valor: 'A confirmar localmente',
        tipo: 'select',
        opcoes: ['Locais certificadas', 'Mercado informal', 'A confirmar localmente'],
        origem: 'agricultor',
        estado: 'por_validar',
        editavel: true
      },
      {
        id: 'calendario',
        nome: 'Início do plantio',
        valor: 'Outubro',
        tipo: 'select',
        opcoes: ['Setembro', 'Outubro', 'Novembro', 'Dezembro'],
        origem: 'literatura',
        estado: 'por_validar',
        editavel: true
      }
    ],
    metadados: {
      fontes: ['NASA POWER', 'FAOSTAT', 'Catálogo Field Shift'],
      resolucoes: 'Chuva e humidade do solo: célula de cerca de 50 km. Vegetação: 250 m.',
      datas_dados: `NASA POWER (${climate.period})`,
      avisos: [
        'This tool supports the farmer\'s decision and does not replace local agronomic assistance.',
        'Does not constitute a weather forecast.'
      ]
    },

    // Legacy fields for compatibility with static interface
    version,
    request,
    climate: { ...climate, source },
    indicators: buildIndicators(climate),
    premises: [
      { key: 'soil', label: 'Tipo de solo', value: request.soil, source: 'Agricultor', status: 'por validar' },
      { key: 'irrigation', label: 'Acesso a rega', value: request.irrigation, source: 'Agricultor', status: 'por validar' },
      { key: 'seeds', label: 'Sementes disponíveis', value: 'A confirmar localmente', source: 'Agricultor', status: 'por validar' },
      { key: 'calendar', label: 'Calendário local de plantio', value: 'Referência regional', source: 'Literatura', status: 'por validar' }
    ],
    metadata: {
      sources: ['NASA POWER', 'Field Shift Catalog'],
      resolution: 'POWER: approx 50 km; NDVI: not available in MVP',
      limitations: ['Not a weather forecast', 'Rainfall represents an approximate 50 km cell']
    }
  };
}

async function fetchPower(latitude, longitude) {
  const key = cacheKey(latitude, longitude);
  if (powerCache.has(key)) return { ...powerCache.get(key), cached: true };

  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 30);

  const url = new URL('https://power.larc.nasa.gov/api/temporal/daily/point');
  url.search = new URLSearchParams({
    parameters: 'T2M,PRECTOTCORR,ALLSKY_SFC_SW_DWN,RH2M',
    community: 'AG',
    longitude: String(longitude),
    latitude: String(latitude),
    start: dateString(start),
    end: dateString(end),
    format: 'JSON'
  });

  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`NASA POWER responded with status ${response.status}`);
  const payload = await response.json();
  const values = payload.properties?.parameter || {};

  const valid = (series) => Object.values(series || {}).filter((value) => Number.isFinite(value) && value > -900);
  const average = (series) => {
    const items = valid(series);
    return items.length ? items.reduce((sum, value) => sum + value, 0) / items.length : 0;
  };
  const sum = (series) => valid(series).reduce((total, value) => total + value, 0);

  const result = {
    source: 'NASA POWER',
    period: `${start.toISOString().slice(0, 10)} a ${end.toISOString().slice(0, 10)}`,
    averageTemperature: Number(average(values.T2M).toFixed(1)),
    totalRainfall: Number(sum(values.PRECTOTCORR).toFixed(1)),
    averageRadiation: Number(average(values.ALLSKY_SFC_SW_DWN).toFixed(1)),
    averageHumidity: Number(average(values.RH2M).toFixed(1)),
    coordinates: { latitude, longitude }
  };

  powerCache.set(key, result);
  return result;
}

// ---------------------------------------------------------------------------
// API ROUTES
// ---------------------------------------------------------------------------

// Crop Catalog (supports /api/culturas and /api/crops)
app.get(['/api/culturas', '/api/crops'], (req, res) => {
  res.json({
    metadata: plants.metadata,
    crops: plants.crops.map((crop) => ({
      id: crop.id,
      nome: crop.name_pt,
      name_pt: crop.name_pt,
      scientific_name: crop.scientific_name,
      botanical_family: crop.botanical_family,
      role_in_rotation: crop.role_in_rotation,
      nitrogen_impact: crop.nitrogen_impact,
      nitrogen_fixation_kg_ha: crop.nitrogen_fixation_kg_ha,
      climate_requirements: crop.climate_requirements,
      soil_requirements: crop.soil_requirements,
      angola_calendar: crop.angola_calendar,
      good_successors: crop.good_successors,
      faostat_stats: crop.faostat_stats
    }))
  });
});

// Direct climate from NASA POWER
app.get('/api/climate', async (req, res) => {
  const latitude = numberInRange(req.query.latitude, -18.5, -4.3, -8.84);
  const longitude = numberInRange(req.query.longitude, 11.6, 24.1, 13.23);
  try {
    res.json(await fetchPower(latitude, longitude));
  } catch (error) {
    res.status(502).json({
      error: 'Could not query NASA POWER at this time.',
      message: 'Could not query NASA POWER at this time.',
      detail: error.message
    });
  }
});

// Direct recommendations by crop
app.get('/api/recommendations', async (req, res) => {
  const latitude = numberInRange(req.query.latitude, -18.5, -4.3, -8.84);
  const longitude = numberInRange(req.query.longitude, 11.6, 24.1, 13.23);
  try {
    const climate = await fetchPower(latitude, longitude);
    const recommendations = plants.crops.map((crop) => buildRecommendation(climate, crop)).sort((a, b) => b.score - a.score);
    res.json({ climate, recommendations });
  } catch (error) {
    res.status(502).json({
      error: 'Could not generate recommendations with NASA data.',
      message: 'Could not generate recommendations with NASA data.',
      detail: error.message
    });
  }
});

// Create Analysis (supports /api/analises and /api/analyses)
app.post(['/api/analises', '/api/analyses'], async (req, res) => {
  const request = normaliseRequest(req.body);
  try {
    const climate = await fetchPower(request.latitude, request.longitude);
    const analysis = buildAnalysis(climate, request);
    analysisCache.set(analysis.id, analysis);
    res.status(201).json(analysis);
  } catch (error) {
    res.status(502).json({
      estado: 'erro',
      erro: {
        codigo: 'nasa_power_erro',
        mensagem: 'Could not generate analysis with NASA data.',
        message: 'Could not generate analysis with NASA data.'
      },
      error: 'Could not generate analysis with NASA data.',
      message: 'Could not generate analysis with NASA data.',
      detail: error.message
    });
  }
});

// Get Analysis (supports /api/analises/:id and /api/analyses/:id)
app.get(['/api/analises/:id', '/api/analyses/:id'], (req, res) => {
  const analysis = analysisCache.get(req.params.id);
  if (!analysis) {
    return res.status(404).json({
      estado: 'erro',
      erro: {
        codigo: 'analise_nao_encontrada',
        mensagem: 'Analysis not found.',
        message: 'Analysis not found.'
      },
      error: 'Analysis not found.',
      message: 'Analysis not found.'
    });
  }
  res.json(analysis);
});

// Update Premises and Recalculate (supports /api/analises/:id/premissas and /api/analyses/:id/premises)
app.patch(['/api/analises/:id/premissas', '/api/analyses/:id/premises'], (req, res) => {
  const analysis = analysisCache.get(req.params.id);
  if (!analysis) {
    return res.status(404).json({
      estado: 'erro',
      erro: {
        codigo: 'analise_nao_encontrada',
        mensagem: 'Analysis not found.',
        message: 'Analysis not found.'
      },
      error: 'Analysis not found.',
      message: 'Analysis not found.'
    });
  }

  // Update request values from submitted body
  const updatedRequest = { ...analysis.request };

  if (req.body.tipo_solo) {
    updatedRequest.soilType = req.body.tipo_solo;
    updatedRequest.soil = req.body.tipo_solo;
  }
  if (req.body.soil) {
    updatedRequest.soil = req.body.soil;
    if (req.body.soil.toLowerCase().includes('arenoso')) updatedRequest.soilType = 'arenoso';
    else if (req.body.soil.toLowerCase().includes('argiloso')) updatedRequest.soilType = 'argiloso';
    else if (req.body.soil.toLowerCase().includes('franco')) updatedRequest.soilType = 'franco';
  }
  if (typeof req.body.rega === 'boolean') {
    updatedRequest.rega = req.body.rega;
    updatedRequest.irrigation = req.body.rega ? 'Sim' : 'Não';
  }
  if (req.body.irrigation) {
    updatedRequest.irrigation = req.body.irrigation === true || req.body.irrigation === 'Sim' ? 'Sim' : 'Não';
    updatedRequest.rega = updatedRequest.irrigation === 'Sim';
  }

  // Recalculate with incremented version keeping the same id
  const nextVersion = (analysis.versao_analise || analysis.version || 1) + 1;
  const updated = buildAnalysis(analysis.climate, updatedRequest, analysis.climate.source, nextVersion);
  updated.id = analysis.id;

  // Update state of validated premises
  updated.premissas = updated.premissas.map((premise) => {
    if (premise.id === 'tipo_solo' && updatedRequest.soilType) {
      return { ...premise, valor: updatedRequest.soilType, estado: 'validada' };
    }
    if (premise.id === 'rega' && typeof updatedRequest.rega === 'boolean') {
      return { ...premise, valor: updatedRequest.rega, estado: 'validada' };
    }
    return premise;
  });

  analysisCache.set(updated.id, updated);
  res.json(updated);
});

// Fallback for legacy static frontend in public/
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

async function start() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured. Refer to README to configure PostgreSQL.');
  }
  await migrate();
  plants = await listPlants();
  if (!plants.crops.length) {
    throw new Error('The plants table is empty. Run npm run db:seed.');
  }
  app.listen(port, () => console.log(`Field Shift backend running at http://localhost:${port}`));
}

start().catch((error) => {
  console.error(`Could not start Field Shift: ${error.message}`);
  process.exitCode = 1;
});
