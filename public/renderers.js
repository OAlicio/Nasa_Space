import { getElements } from './dom.js';

const { metrics, recommendations, premiseList, indicatorGrid, period, limitations } = getElements();
const metricCards = [
  ['averageTemperature', 'Temperatura média', '°C', 'temperature'],
  ['totalRainfall', 'Chuva acumulada', 'mm', 'rain'],
  ['averageHumidity', 'Humidade relativa', '%', 'humidity'],
  ['averageRadiation', 'Radiação solar', 'kWh/m²/dia', 'sun']
];

function renderClimate(climate) {
  metrics.innerHTML = metricCards.map(([key, label, unit, icon]) => `<article class="metric"><span class="metric-icon">${icon === 'rain' ? '⌁' : icon === 'sun' ? '☼' : icon === 'humidity' ? '◌' : '°'}</span><p>${label}</p><strong>${climate[key]}<small>${unit}</small></strong></article>`).join('');
  period.textContent = climate.cached ? 'CACHE · ' + climate.period : climate.period;
}

function renderIndicators(indicators) {
  const peak = Math.max(...indicators.rainfall.map((item) => item.value), 1);
  indicatorGrid.innerHTML = `<article class="indicator-card"><div class="chart-bars">${indicators.rainfall.map((item) => `<div class="bar-wrap"><i style="height:${Math.max(8, item.value / peak * 100)}%"></i><small>${item.month}</small></div>`).join('')}</div><p>Chuva mensal observada / estimada</p></article><article class="indicator-card facts"><div><strong>${indicators.wetSeasonStart}</strong><span>início estimado da época das chuvas</span></div><div><strong>${indicators.dryPeriods}</strong><span>períodos secos recentes</span></div><div><strong>${indicators.soilMoisture}%</strong><span>humidade relativa média</span></div></div></article>`;
}

function renderStrategies(items) {
  recommendations.innerHTML = items.map((item, index) => `<article class="strategy ${index === 0 ? 'reference' : ''}"><div class="strategy-top"><div><span class="strategy-label">${item.label}${index === 0 ? ' · referência' : ''}</span><h3>${item.title}</h3></div><div class="big-score"><strong>${item.score}</strong><small>/ 100</small><span>confiança ${item.confidence.toLowerCase()}</span></div></div><div class="sequence">${item.sequence.map((crop, season) => `<div><small>Época ${season + 1}</small><strong>${crop}</strong></div>`).join('')}</div><div class="strategy-columns"><div><b>Porque foi sugerida</b><p>${item.why}</p></div><div><b>Evidência</b><p>${item.evidence.join(' · ')}</p></div><div><b>Benefícios</b><p>${item.benefits.join(' · ')}</p></div><div><b>Lacunas e riscos</b><p>${item.gaps.concat(item.risks).join(' · ')}</p></div></div></article>`).join('');
}

function renderPremises(items) {
  premiseList.innerHTML = items.map((premise) => `<label class="premise"><span><strong>${premise.label}</strong><small>Origem: ${premise.source} · ${premise.status}</small></span><input data-key="${premise.key}" value="${premise.value}" /></label>`).join('');
}

export function renderAnalysis(data) {
  renderClimate(data.climate);
  renderIndicators(data.indicators);
  renderStrategies(data.strategies);
  renderPremises(data.premises);
  limitations.textContent = `Limitações: ${data.metadata.limitations.join(' · ')}. ${data.indicators.note}`;
}