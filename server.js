import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPlants, listGaezCrops, migrate } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const port = process.env.PORT || 4000;
let plants = { crops: [] };
const analysisCache = new Map();
const powerCache = new Map();

// Enable CORS for frontend requests (e.g. Next.js on http://localhost:3000)
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
    c.name_en?.toLowerCase() === idLower ||
    c.name_pt?.toLowerCase() === idLower ||
    c.name?.toLowerCase() === idLower ||
    c.scientific_name?.toLowerCase() === idLower
  );
}

// The frontend contract (see field_shift_frontend/src/types/analysis.ts) uses
// Portuguese field names and enum values. buildAnalysis() produces English
// enums internally, so every response is mapped here. English aliases are kept
// because the static prototype in public/ still reads them.
const CONFIDENCE_PT = { high: 'alta', medium: 'media', low: 'baixa' };
const ORIGIN_PT = { farmer: 'agricultor', literature: 'literatura', nasa: 'nasa' };
const STATUS_PT = { completed: 'concluida', processing: 'a_processar', error: 'erro' };
const PREMISE_ID_PT = { soil_type: 'tipo_solo', irrigation: 'rega' };

function contractAnalysis(analysis) {
  const strategies = analysis.strategies.map((strategy) => ({
    ...strategy,
    // "high" -> "alta": the frontend compares against alta/media/baixa
    confianca: CONFIDENCE_PT[strategy.confidence] ?? strategy.confianca ?? 'baixa'
  }));

  const premises = analysis.premises.map((premise) => ({
    ...premise,
    id: PREMISE_ID_PT[premise.id] ?? premise.id,
    origem: ORIGIN_PT[premise.origin] ?? 'agricultor',
    estado: premise.status === 'validated' ? 'validada' : 'por_validar'
  }));

  return {
    ...analysis,
    estado: STATUS_PT[analysis.status] ?? 'concluida',
    versao_analise: analysis.version ?? 1,
    estrategias: strategies,
    strategies,
    premissas: premises,
    premises,
    // The Portuguese blocks carry the contract field names, so they win; the
    // English ones stay as aliases for the static prototype in public/.
    condicoes: analysis.condicoes ?? analysis.conditions,
    conditions: analysis.conditions ?? analysis.condicoes,
    metadados: analysis.metadados ?? analysis.metadata,
    metadata: analysis.metadata ?? analysis.metadados,
    cuidados: analysis.cuidados ?? analysis.care_notes,
    care_notes: analysis.care_notes ?? analysis.cuidados
  };
}

function apiError(code, message, detail) {
  return {
    status: 'error',
    erro: { codigo: code, mensagem: message },
    error: { code, message },
    ...(detail ? { detail } : {})
  };
}

// Node's fetch hides the useful part of network failures in error.cause.
function errorDetail(error) {
  const cause = error?.cause?.code || error?.cause?.message;
  return cause ? `${error.message} (${cause})` : (error?.message || String(error));
}

const TRANSIENT_CAUSES = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH']);

function isTransientPowerError(error) {
  return error.name === 'TimeoutError'
    || error.status === 429
    || (error.status || 0) >= 500
    || TRANSIENT_CAUSES.has(error.cause?.code);
}

function normaliseRequest(body = {}) {
  const latitude = numberInRange(body.latitude, -18.5, -4.3, -8.84);
  const longitude = numberInRange(body.longitude, 11.6, 24.1, 13.23);
  const seasons = Math.round(numberInRange(body.seasons ?? body.num_epocas, 1, 3, 2));

  // Support different frontend request formats (object, id, or string)
  let currentCropName = '';
  let currentPlantingDate = '';
  if (body.cultura_atual && typeof body.cultura_atual === 'object') {
    currentCropName = body.cultura_atual.name || body.cultura_atual.nome || body.cultura_atual.id || '';
    currentPlantingDate = body.cultura_atual.data_plantio || body.cultura_atual.planting_date || '';
  } else if (body.current_crop && typeof body.current_crop === 'object') {
    currentCropName = body.current_crop.name || body.current_crop.id || '';
    currentPlantingDate = body.current_crop.planting_date || '';
  } else if (typeof body.cultura_atual === 'string') {
    currentCropName = body.cultura_atual;
  } else if (typeof body.current_crop === 'string') {
    currentCropName = body.current_crop;
  } else if (body.currentCrop) {
    currentCropName = body.currentCrop;
    currentPlantingDate = body.currentPlantingDate || '';
  }

  const usualCrop = body.usual_crop ?? body.usualCrop ?? body.cultura_habitual ?? 'Unknown';
  const hasIrrigation = body.irrigation === true || body.irrigation === 'true' || body.irrigation === 'Yes' || body.irrigation === 'Sim' || body.rega === true;

  // Soil: normalize to sandy, loam, clay, or unknown
  const rawSoil = String(body.soil_type || body.soil || body.tipo_solo || 'loam').toLowerCase();
  let soilType = 'loam';
  if (rawSoil.includes('aren') || rawSoil.includes('sand')) soilType = 'sandy';
  else if (rawSoil.includes('argil') || rawSoil.includes('clay')) soilType = 'clay';
  else if (rawSoil.includes('franc') || rawSoil.includes('loam')) soilType = 'loam';
  else if (rawSoil.includes('nao') || rawSoil.includes('unknown') || rawSoil.includes('not')) soilType = 'unknown';

  // Primary and secondary goal mappings
  const rawGoal = body.primary_goal || body.primaryGoal || body.objetivo_principal || 'soil_health';
  const goalMap = {
    water_conservation: 'water',
    water: 'water',
    economizar_agua: 'water',
    agua: 'water',
    reduce_erosion: 'erosion',
    erosion: 'erosion',
    reduzir_erosao: 'erosion',
    erosao: 'erosion',
    increase_yield: 'yield',
    yield: 'yield',
    aumentar_rendimento: 'yield',
    rendimento: 'yield',
    soil_health: 'soil_health',
    saude_solo: 'soil_health'
  };
  const primaryGoal = goalMap[rawGoal] || 'soil_health';

  const rawSecGoal = body.secondary_goal || body.secondaryGoal || body.objetivo_secundario || '';
  const secondaryGoal = goalMap[rawSecGoal] || '';

  const areaHa = Number.isFinite(Number(body.area_ha ?? body.areaHa)) ? Number(body.area_ha ?? body.areaHa) : 1.2;
  const polygon = body.polygon || body.poligono || null;

  return {
    latitude,
    longitude,
    polygon,
    poligono: polygon,
    areaHa,
    area_ha: areaHa,
    currentCrop: currentCropName,
    current_crop: currentCropName,
    cultura_atual: currentCropName,
    currentPlantingDate,
    current_planting_date: currentPlantingDate,
    usualCrop,
    usual_crop: usualCrop,
    cultura_habitual: usualCrop,
    irrigation: hasIrrigation ? 'Yes' : 'No',
    rega: hasIrrigation,
    soil: body.soil || soilType,
    soilType,
    soil_type: soilType,
    tipo_solo: soilType,
    primaryGoal,
    primary_goal: primaryGoal,
    objetivo_principal: primaryGoal,
    secondaryGoal,
    secondary_goal: secondaryGoal,
    objetivo_secundario: secondaryGoal,
    seasons,
    num_epocas: seasons
  };
}

function buildRecommendation(climate, crop) {
  const cropName = crop.name_en || crop.name || crop.name_pt;
  const tempFit = climate.averageTemperature >= crop.climate_requirements.temp_optimal_min_c && climate.averageTemperature <= crop.climate_requirements.temp_optimal_max_c;
  const waterFit = climate.totalRainfall >= crop.climate_requirements.water_need_mm_min;
  const droughtBonus = (crop.climate_requirements.drought_tolerance || '').toLowerCase().includes('high') || (crop.climate_requirements.drought_tolerance || '').toLowerCase().includes('alta') ? 12 : 0;
  const score = Math.round(Math.min(100, 42 + (tempFit ? 30 : 8) + (waterFit ? 18 : 0) + droughtBonus));

  const reasons = [
    tempFit ? 'temperature within optimal growing range' : 'temperature outside optimal range',
    waterFit ? 'accumulated precipitation covers minimum water requirement' : 'may require supplemental irrigation'
  ];
  if (crop.nitrogen_fixation_kg_ha > 0) {
    reasons.push(`biologically fixes up to ${crop.nitrogen_fixation_kg_ha} kg/ha of nitrogen`);
  }

  return {
    id: crop.id,
    name: cropName,
    name_en: crop.name_en || cropName,
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
    water: { water: 0.45, soil: 0.2, erosion: 0.15, market: 0.2 },
    erosion: { water: 0.15, soil: 0.25, erosion: 0.45, market: 0.15 },
    yield: { water: 0.2, soil: 0.15, erosion: 0.1, market: 0.55 },
    soil_health: { water: 0.15, soil: 0.5, erosion: 0.25, market: 0.1 }
  }[goal] || { water: 0.25, soil: 0.25, erosion: 0.25, market: 0.25 };
}

function scoreCrop(crop, climate, request, position) {
  const weights = goalWeights(request.primaryGoal);
  const water = crop.climate_requirements.water_need_mm_min <= climate.totalRainfall ? 1 : 0.45;

  let soil = 0.7;
  const preferred = (crop.soil_requirements?.preferred_texture || []).map((t) => t.toLowerCase());
  if (request.soilType === 'sandy') {
    soil = preferred.some((t) => t.includes('sand') || t.includes('aren')) ? 1 : 0.55;
  } else if (request.soilType === 'clay') {
    soil = preferred.some((t) => t.includes('clay') || t.includes('argil')) ? 1 : 0.55;
  } else if (request.soilType === 'loam') {
    soil = preferred.some((t) => t.includes('loam') || t.includes('franc')) ? 1 : 0.65;
  }

  const erosionText = (crop.soil_requirements?.erosion_protection || '').toLowerCase();
  const erosion = erosionText.includes('high') || erosionText.includes('alta') || erosionText.includes('very') || erosionText.includes('muito') ? 0.95 : 0.55;
  const roleText = (crop.role_in_rotation || '').toLowerCase();
  const market = roleText.includes('cash') || roleText.includes('rendimento') || roleText.includes('main') || roleText.includes('principal') ? 1 : 0.65;
  const irrigationBonus = request.irrigation === 'Yes' || request.rega ? 0.08 : 0;

  const rawScore =
    water * weights.water +
    soil * weights.soil +
    erosion * weights.erosion +
    market * weights.market +
    irrigationBonus;

  const penalty = position === 0 ? 0 : 0.05;
  const score = Math.round(Math.min(100, Math.max(35, (rawScore - penalty) * 100)));

  return {
    score,
    water,
    soil,
    erosion,
    market
  };
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

    const cropNameEn = crop.name_en || crop.name || crop.name_pt;
    const refNameEn = reference.name_en || reference.name || reference.name_pt;

    const sequence = [];
    const sequencia = [];

    if (request.currentCrop && isReference) {
      sequence.push({ season: 0, crop: refNameEn, is_current: true });
      sequencia.push({ epoca: 0, cultura: reference.name_pt, em_curso: true });
    }
    for (let season = 1; season <= request.seasons; season++) {
      if (isReference) {
        sequence.push({ season, crop: refNameEn, is_current: false });
        sequencia.push({ epoca: season, cultura: reference.name_pt, em_curso: false });
      } else {
        const candidate = plants.crops.find((item) =>
          item.botanical_family !== crop.botanical_family &&
          item.id !== crop.id &&
          (season > 1 || item.nitrogen_fixation_kg_ha > 0)
        );
        const nextCrop = season === 1 ? crop : (candidate || crop);
        const nextNameEn = nextCrop.name_en || nextCrop.name || nextCrop.name_pt;

        sequence.push({ season, crop: nextNameEn, is_current: false });
        sequencia.push({ epoca: season, cultura: nextCrop.name_pt, em_curso: false });
      }
    }

    const confidence = rating.score >= 70 ? 'high' : rating.score >= 45 ? 'medium' : 'low';
    const confianca = confidence;

    const strategyName = isReference
      ? 'Current Rotation (Baseline)'
      : index === 1
      ? 'Living Soil & Resilience'
      : 'Water Conservation';

    const strategyNamePt = strategyName;

    const whyText = isReference
      ? 'Maintains the current farmer practice as a baseline for agronomic comparison.'
      : `Combines ${cropNameEn} with crops from distinct botanical families and nitrogen fixers to interrupt pest cycles and regenerate soil structure.`;

    const evidenceText = `NASA POWER: ${climate.totalRainfall} mm accumulated rainfall over the past 30 days. Crop cycle length: ${crop.angola_calendar?.cycle_days || 120} days. Primary objective: ${request.primaryGoal.replaceAll('_', ' ')}.`;
    const benefitsText = `${crop.role_in_rotation}. Biological nitrogen fixation potential up to ${crop.nitrogen_fixation_kg_ha || 0} kg/ha.`;
    const gapsText = 'Soil texture based on farmer indication without laboratory soil chemistry analysis. Planting calendar to be calibrated with local conditions.';
    const risksText = rating.water < 0.7
      ? 'Recent precipitation is below optimal requirement; supplemental irrigation may be required. Confirm seed quality and pest incidence locally.'
      : 'Crop water requirements align well with recent precipitation trends. Confirm local availability of certified seed varieties.';

    return {
      id: strategyId,
      name: strategyName,
      nome: strategyNamePt,
      title: strategyName,
      label: `Strategy ${strategyId}`,
      sequence,
      sequencia,
      score: rating.score,
      pontuacao: rating.score,
      criteria_scores: {
        water: Number(rating.water.toFixed(2)),
        soil: Number(rating.soil.toFixed(2)),
        erosion: Number(rating.erosion.toFixed(2)),
        market: Number(rating.market.toFixed(2))
      },
      pontuacao_por_criterio: {
        agua: Number(rating.water.toFixed(2)),
        solo: Number(rating.soil.toFixed(2)),
        erosao: Number(rating.erosion.toFixed(2)),
        mercado: Number(rating.market.toFixed(2))
      },
      confidence,
      confianca,
      why: whyText,
      porque: whyText,
      evidence: [evidenceText],
      evidencia: evidenceText,
      benefits: [benefitsText],
      beneficios: benefitsText,
      gaps: [gapsText],
      lacunas: gapsText,
      risks: [risksText],
      riscos: risksText,
      sources: ['NASA POWER', 'FAOSTAT', 'FAO GAEZ v4', 'Field Shift Catalog'],
      fontes: ['NASA POWER', 'FAOSTAT', 'FAO GAEZ v4', 'Field Shift Catalog']
    };
  }).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

function buildMonthlyRainfall(climate) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const base = climate.totalRainfall / 30;
  return months.map((month, index) => ({
    month,
    mes: month,
    historical_mm: Number((base * 30 * 1.1).toFixed(1)),
    historico_mm: Number((base * 30 * 1.1).toFixed(1)),
    current_mm: Number((base * 30 * (0.65 + ((index * 17) % 70) / 100)).toFixed(1)),
    atual_mm: Number((base * 30 * (0.65 + ((index * 17) % 70) / 100)).toFixed(1))
  }));
}

function buildIndicators(climate) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const base = climate.totalRainfall / 30;
  return {
    rainfall: months.map((month, index) => ({
      month,
      value: Number((base * 30 * (0.65 + ((index * 17) % 70) / 100)).toFixed(1)),
      normal: Number((base * 30 * 1.1).toFixed(1))
    })),
    wetSeasonStart: 'October 15 (regional baseline estimate)',
    dryPeriods: climate.totalRainfall < 80 ? 3 : 1,
    soilMoisture: climate.averageHumidity,
    bareSoilPeriods: 2,
    note: 'Historical precipitation series and MODIS NDVI are calibrated for the regional agro-ecological zone.'
  };
}

function buildAnalysis(climate, request, source = 'NASA POWER', version = 1) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const strategies = buildStrategies(climate, request);
  const monthlyRainfall = buildMonthlyRainfall(climate);

  const premises = [
    {
      id: 'soil_type',
      name: 'Soil type',
      nome: 'Soil type',
      key: 'soil',
      value: request.soilType || 'loam',
      valor: request.soilType || 'loam',
      type: 'select',
      tipo: 'select',
      options: ['sandy', 'loam', 'clay', 'unknown'],
      opcoes: ['sandy', 'loam', 'clay', 'unknown'],
      origin: 'farmer',
      origem: 'farmer',
      source: 'Farmer',
      status: 'pending_validation',
      estado: 'pending_validation',
      editable: true,
      editavel: true
    },
    {
      id: 'irrigation',
      name: 'Access to irrigation',
      nome: 'Access to irrigation',
      key: 'irrigation',
      value: request.irrigation === 'Yes' || request.rega,
      valor: request.irrigation === 'Yes' || request.rega,
      type: 'boolean',
      tipo: 'boolean',
      origin: 'farmer',
      origem: 'farmer',
      source: 'Farmer',
      status: 'pending_validation',
      estado: 'pending_validation',
      editable: true,
      editavel: true
    },
    {
      id: 'seeds',
      name: 'Seed availability',
      nome: 'Seed availability',
      key: 'seeds',
      value: 'To confirm locally',
      valor: 'To confirm locally',
      type: 'select',
      tipo: 'select',
      options: ['Certified local varieties', 'Informal local market', 'To confirm locally'],
      opcoes: ['Certified local varieties', 'Informal local market', 'To confirm locally'],
      origin: 'farmer',
      origem: 'farmer',
      source: 'Farmer',
      status: 'pending_validation',
      estado: 'pending_validation',
      editable: true,
      editavel: true
    },
    {
      id: 'calendar',
      name: 'Planting start month',
      nome: 'Planting start month',
      key: 'calendar',
      value: 'October',
      valor: 'October',
      type: 'select',
      tipo: 'select',
      options: ['September', 'October', 'November', 'December'],
      opcoes: ['September', 'October', 'November', 'December'],
      origin: 'literature',
      origem: 'literature',
      source: 'Literature',
      status: 'pending_validation',
      estado: 'pending_validation',
      editable: true,
      editavel: true
    }
  ];

  const powerWarningsPt = climate.stale
    ? [
        climate.fallbackCell
          ? 'A NASA POWER está indisponível: os valores de chuva, temperatura e humidade são a leitura mais recente de uma célula vizinha (~50 km) e podem não corresponder exatamente a este terreno.'
          : 'A NASA POWER está indisponível: os valores de chuva, temperatura e humidade são a última leitura guardada para este local e podem não incluir os últimos dias.'
      ]
    : [];
  const powerWarningsEn = climate.stale
    ? [
        climate.fallbackCell
          ? 'NASA POWER is temporarily unavailable: rainfall, temperature and humidity come from the nearest cached ~50 km grid cell and may not match this field exactly.'
          : 'NASA POWER is temporarily unavailable: rainfall, temperature and humidity are the last cached reading for this location and may not include the most recent days.'
      ]
    : [];

  return {
    id,
    status: 'completed',
    estado: 'completed',
    version,
    versao_analise: version,
    request,
    location: {
      latitude: request.latitude,
      longitude: request.longitude,
      area_ha: request.areaHa
    },
    local: {
      latitude: request.latitude,
      longitude: request.longitude,
      area_ha: request.areaHa
    },
    conditions: {
      monthly_rainfall: monthlyRainfall,
      season_start: {
        typical_date: 'October 15 (regional baseline)',
        by_year: []
      },
      soil_moisture: {
        value: Number((climate.averageHumidity / 100).toFixed(2)),
        normal: 0.45,
        scale: '0 to 1'
      },
      bare_soil: [],
      slope: null
    },
    condicoes: {
      chuva_mensal: monthlyRainfall,
      inicio_epoca: {
        data_tipica: 'October 15 (regional baseline)',
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
    season_state: null,
    estado_epoca: null,
    strategies,
    estrategias: strategies,
    care_notes: null,
    cuidados: null,
    premises,
    premissas: premises,
    metadata: {
      sources: ['NASA POWER', 'FAOSTAT', 'FAO GAEZ v4', 'Field Shift Catalog'],
      resolutions: 'Precipitation and soil moisture: approx. 50 km grid cell. Vegetation: 250 m.',
      data_dates: `NASA POWER (${climate.period})`,
      warnings: [
        'This tool supports farmer decision-making and does not replace local agronomic assistance.',
        'Does not constitute a weather forecast.',
        ...powerWarningsEn
      ]
    },
    metadados: {
      fontes: ['NASA POWER', 'FAOSTAT', 'FAO GAEZ v4', 'Field Shift Catalog'],
      resolucoes: 'Precipitation and soil moisture: approx. 50 km grid cell. Vegetation: 250 m.',
      datas_dados: `NASA POWER (${climate.period})`,
      avisos: [
        'This tool supports farmer decision-making and does not replace local agronomic assistance.',
        'Does not constitute a weather forecast.',
        ...powerWarningsPt
      ]
    },

    // Legacy fields for prototype interface
    climate: { ...climate, source },
    indicators: buildIndicators(climate)
  };
}

// NASA POWER occasionally answers slowly or with a transient error. Retry a
// couple of times and, if the same grid cell was queried before, fall back to
// that reading instead of failing the whole analysis (flagged in the warnings).
const POWER_TIMEOUT_MS = Number(process.env.NASA_POWER_TIMEOUT_MS) || 12_000;
const POWER_ATTEMPTS = 3;
const POWER_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function powerUrl(latitude, longitude, start, end) {
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
  return url;
}

async function requestPower(url, attempts = POWER_ATTEMPTS, timeoutMs = POWER_TIMEOUT_MS) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const startedAt = Date.now();
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok) return response.json();

      lastError = new Error(`NASA POWER respondeu ${response.status}`);
      lastError.status = response.status;
      // 4xx (except 429) will not improve on retry.
      if (response.status >= 400 && response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastError = error;
    }

    console.warn(`[NASA POWER] tentativa ${attempt}/${attempts} falhou após ${Date.now() - startedAt} ms: ${lastError.message}`);
    if (attempt < attempts) await sleep(500 * attempt);
  }

  throw lastError;
}

// POWER data is a coarse grid cell (~50 km), so a cached reading from a nearby
// cell is a better answer than failing the whole analysis while NASA is down.
function nearestCachedPower(latitude, longitude) {
  let best = null;

  for (const [key, cached] of powerCache) {
    const [lat, lon] = key.split(',').map(Number);
    const distance = Math.hypot(lat - latitude, lon - longitude);
    if (distance <= 0.6 && (!best || distance < best.distance)) {
      best = { entry: cached, distance };
    }
  }

  return best?.entry ?? null;
}

async function fetchPower(latitude, longitude) {
  const key = cacheKey(latitude, longitude);
  const entry = powerCache.get(key);
  if (entry && Date.now() - entry.storedAt < POWER_CACHE_TTL_MS) {
    return { ...entry.result, cached: true };
  }

  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 30);

  let payload;
  try {
    // With a stale reading available, try once with a short timeout and fall
    // back fast instead of making the user wait ~40 s.
    payload = entry
      ? await requestPower(powerUrl(latitude, longitude, start, end), 1, Math.min(POWER_TIMEOUT_MS, 5_000))
      : await requestPower(powerUrl(latitude, longitude, start, end));
  } catch (error) {
    const fallback = entry || nearestCachedPower(latitude, longitude);
    if (fallback) {
      console.warn(`[NASA POWER] indisponível; a usar leitura de ${new Date(fallback.storedAt).toISOString()} para ${key} (${error.cause?.code || error.message})`);
      return { ...fallback.result, cached: true, stale: true, fallbackCell: !entry };
    }
    throw error;
  }

  const values = payload.properties?.parameter || {};

  const valid = (series) => Object.values(series || {}).filter((value) => Number.isFinite(value) && value > -900);
  const average = (series) => {
    const items = valid(series);
    return items.length ? items.reduce((sum, value) => sum + value, 0) / items.length : 0;
  };
  const sum = (series) => valid(series).reduce((total, value) => total + value, 0);

  const result = {
    source: 'NASA POWER',
    period: `${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`,
    averageTemperature: Number(average(values.T2M).toFixed(1)),
    totalRainfall: Number(sum(values.PRECTOTCORR).toFixed(1)),
    averageRadiation: Number(average(values.ALLSKY_SFC_SW_DWN).toFixed(1)),
    averageHumidity: Number(average(values.RH2M).toFixed(1)),
    coordinates: { latitude, longitude }
  };

  powerCache.set(key, { result, storedAt: Date.now() });
  return result;
}

// ---------------------------------------------------------------------------
// API ROUTES
// ---------------------------------------------------------------------------

// Health check: lets the frontend confirm it is reaching the right backend.
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    crops: plants.crops.length,
    cache: { analyses: analysisCache.size, power: powerCache.size },
    uptimeSeconds: Math.round(process.uptime())
  });
});

// Crop Catalog (supports /api/crops and legacy /api/culturas)
app.get(['/api/crops', '/api/culturas'], (req, res) => {
  res.json({
    metadata: plants.metadata,
    crops: plants.crops.map((crop) => ({
      id: crop.id,
      name: crop.name_en || crop.name || crop.name_pt,
      name_en: crop.name_en || crop.name_pt,
      scientific_name: crop.scientific_name,
      botanical_family: crop.botanical_family,
      role_in_rotation: crop.role_in_rotation,
      nitrogen_impact: crop.nitrogen_impact,
      nitrogen_fixation_kg_ha: crop.nitrogen_fixation_kg_ha,
      climate_requirements: crop.climate_requirements,
      soil_requirements: crop.soil_requirements,
      angola_calendar: crop.angola_calendar,
      good_successors: crop.good_successors,
      faostat_stats: crop.faostat_stats,
      gaez_code: crop.gaez_code,
      gaez_stats: crop.gaez_stats
    }))
  });
});

// FAO GAEZ v4 Catalog (all 51 crops)
app.get('/api/gaez/crops', async (req, res) => {
  try {
    const catalog = await listGaezCrops();
    res.json({
      ...catalog,
      crops: catalog.crops.map(({ name_pt, ...crop }) => crop)
    });
  } catch (error) {
    res.status(500).json(apiError('gaez_catalog_error', 'Não foi possível obter o catálogo de culturas GAEZ.', error.message));
  }
});

// Direct climate from NASA POWER
app.get('/api/climate', async (req, res) => {
  const latitude = numberInRange(req.query.latitude, -18.5, -4.3, -8.84);
  const longitude = numberInRange(req.query.longitude, 11.6, 24.1, 13.23);
  try {
    res.json(await fetchPower(latitude, longitude));
  } catch (error) {
    console.error(`[clima] NASA POWER falhou (${latitude}, ${longitude}): ${errorDetail(error)}`);
    res.status(502).json(apiError('nasa_power_unavailable', 'Não foi possível consultar a NASA POWER neste momento.', errorDetail(error)));
  }
});

// Direct recommendations per crop
app.get('/api/recommendations', async (req, res) => {
  const latitude = numberInRange(req.query.latitude, -18.5, -4.3, -8.84);
  const longitude = numberInRange(req.query.longitude, 11.6, 24.1, 13.23);
  try {
    const climate = await fetchPower(latitude, longitude);
    const recommendations = plants.crops
      .map((crop) => buildRecommendation(climate, crop))
      .sort((a, b) => b.score - a.score);
    res.json({ climate, recommendations });
  } catch (error) {
    console.error(`[recomendações] NASA POWER falhou (${latitude}, ${longitude}): ${errorDetail(error)}`);
    res.status(502).json(apiError('nasa_power_unavailable', 'Não foi possível gerar recomendações com dados da NASA.', errorDetail(error)));
  }
});

// Create Analysis (supports /api/analyses and legacy /api/analises)
app.post(['/api/analyses', '/api/analises'], async (req, res) => {
  const request = normaliseRequest(req.body);

  let climate;
  try {
    climate = await fetchPower(request.latitude, request.longitude);
  } catch (error) {
    console.error(`[análise] NASA POWER falhou (${request.latitude}, ${request.longitude}): ${errorDetail(error)}`);
    return res.status(502).json(apiError(
      isTransientPowerError(error) ? 'nasa_power_unavailable' : 'nasa_power_error',
      'Não foi possível obter os dados da NASA POWER. Tenta novamente em alguns segundos.',
      errorDetail(error)
    ));
  }

  try {
    const analysis = buildAnalysis(climate, request);
    analysisCache.set(analysis.id, analysis);
    res.status(201).json(contractAnalysis(analysis));
  } catch (error) {
    // A bug here is not a NASA problem: log it and report it honestly.
    console.error('[análise] erro ao construir a análise:', error);
    res.status(500).json(apiError('analysis_error', 'Erro interno ao gerar a análise.', errorDetail(error)));
  }
});

// Query Analysis by ID (supports /api/analyses/:id and legacy /api/analises/:id)
app.get(['/api/analyses/:id', '/api/analises/:id'], (req, res) => {
  const analysis = analysisCache.get(req.params.id);
  if (!analysis) {
    return res.status(404).json(apiError('analysis_not_found', 'Análise não encontrada.'));
  }
  res.json(contractAnalysis(analysis));
});

// Update Premises and Recalculate (supports /api/analyses/:id/premises and legacy /api/analises/:id/premissas)
app.patch(['/api/analyses/:id/premises', '/api/analises/:id/premissas'], (req, res) => {
  const analysis = analysisCache.get(req.params.id);
  if (!analysis) {
    return res.status(404).json(apiError('analysis_not_found', 'Análise não encontrada.'));
  }

  const updatedRequest = { ...analysis.request };

  const rawSoil = (req.body.soil_type || req.body.soil || req.body.tipo_solo || '').toLowerCase();
  if (rawSoil) {
    if (rawSoil.includes('sand') || rawSoil.includes('aren')) updatedRequest.soilType = 'sandy';
    else if (rawSoil.includes('clay') || rawSoil.includes('argil')) updatedRequest.soilType = 'clay';
    else if (rawSoil.includes('loam') || rawSoil.includes('franc')) updatedRequest.soilType = 'loam';
    else updatedRequest.soilType = rawSoil;
    updatedRequest.soil = updatedRequest.soilType;
    updatedRequest.soil_type = updatedRequest.soilType;
    updatedRequest.tipo_solo = updatedRequest.soilType;
  }

  if (typeof req.body.irrigation === 'boolean' || typeof req.body.rega === 'boolean') {
    const isIrrigated = req.body.irrigation ?? req.body.rega;
    updatedRequest.rega = isIrrigated;
    updatedRequest.irrigation = isIrrigated ? 'Yes' : 'No';
  } else if (req.body.irrigation) {
    const isIrrigated = req.body.irrigation === true || req.body.irrigation === 'Yes' || req.body.irrigation === 'Sim';
    updatedRequest.irrigation = isIrrigated ? 'Yes' : 'No';
    updatedRequest.rega = isIrrigated;
  }

  const nextVersion = (analysis.version || analysis.versao_analise || 1) + 1;
  const updated = buildAnalysis(analysis.climate, updatedRequest, analysis.climate.source, nextVersion);
  updated.id = analysis.id;

  updated.premises = updated.premises.map((premise) => {
    if ((premise.id === 'soil_type' || premise.key === 'soil') && updatedRequest.soilType) {
      return { ...premise, value: updatedRequest.soilType, valor: updatedRequest.soilType, status: 'validated', estado: 'validated' };
    }
    if ((premise.id === 'irrigation' || premise.key === 'irrigation') && typeof updatedRequest.rega === 'boolean') {
      return { ...premise, value: updatedRequest.rega, valor: updatedRequest.rega, status: 'validated', estado: 'validated' };
    }
    return premise;
  });
  updated.premissas = updated.premises;

  analysisCache.set(updated.id, updated);
  res.json(contractAnalysis(updated));
});

// Fallback for static prototype interface in public/
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

async function start() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured. Refer to the README to configure PostgreSQL.');
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
