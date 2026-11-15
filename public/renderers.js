import { getElements } from './dom.js';

const { metrics, recommendations, premiseList, indicatorGrid, period, limitations } = getElements();
const metricCards = [
  ['averageTemperature', 'Average Temperature', '°C', 'temperature'],
  ['totalRainfall', 'Accumulated Rainfall', 'mm', 'rain'],
  ['averageHumidity', 'Relative Humidity', '%', 'humidity'],
  ['averageRadiation', 'Solar Radiation', 'kWh/m²/day', 'sun']
];

function renderClimate(climate) {
  metrics.innerHTML = metricCards.map(([key, label, unit, icon]) => `<article class="metric"><span class="metric-icon">${icon === 'rain' ? '⌁' : icon === 'sun' ? '☼' : icon === 'humidity' ? '◌' : '°'}</span><p>${label}</p><strong>${climate[key]}<small>${unit}</small></strong></article>`).join('');
  period.textContent = climate.cached ? 'CACHE · ' + climate.period : climate.period;
}

function renderIndicators(indicators) {
  const peak = Math.max(...indicators.rainfall.map((item) => item.value), 1);
  indicatorGrid.innerHTML = `
    <article class="indicator-card">
      <div class="chart-bars">
        ${indicators.rainfall.map((item) => `<div class="bar-wrap"><i style="height:${Math.max(8, (item.value / peak) * 100)}%"></i><small>${item.month}</small></div>`).join('')}
      </div>
      <p>Observed / Estimated Monthly Rainfall</p>
    </article>
    <article class="indicator-card facts">
      <div><strong>${indicators.wetSeasonStart}</strong><span>Estimated rainy season start</span></div>
      <div><strong>${indicators.dryPeriods}</strong><span>Recent dry spells (< 80 mm)</span></div>
      <div><strong>${indicators.soilMoisture}%</strong><span>Average relative humidity</span></div>
    </article>
  `;
}

function renderStrategies(items) {
  recommendations.innerHTML = items.map((item, index) => `
    <article class="strategy ${index === 0 ? 'reference' : ''}">
      <div class="strategy-top">
        <div>
          <span class="strategy-label">${item.label || `Strategy ${item.id}`}${index === 0 ? ' · Baseline' : ''}</span>
          <h3>${item.title || item.name}</h3>
        </div>
        <div class="big-score">
          <strong>${item.score || item.pontuacao}</strong><small>/ 100</small>
          <span>${item.confidence || 'Medium'} confidence</span>
        </div>
      </div>
      <div class="sequence">
        ${(item.sequence || []).map((step, idx) => `<div><small>Season ${step.season ?? idx + 1}</small><strong>${step.crop || step.cultura || step}</strong></div>`).join('')}
      </div>
      <div class="strategy-columns">
        <div><b>Rationale</b><p>${item.why || item.porque}</p></div>
        <div><b>Data Evidence</b><p>${Array.isArray(item.evidence) ? item.evidence.join(' · ') : (item.evidence || item.evidencia)}</p></div>
        <div><b>Agronomic Benefits</b><p>${Array.isArray(item.benefits) ? item.benefits.join(' · ') : (item.benefits || item.beneficios)}</p></div>
        <div><b>Gaps & Validation Risks</b><p>${(item.gaps ? (Array.isArray(item.gaps) ? item.gaps : [item.gaps]) : []).concat(item.risks ? (Array.isArray(item.risks) ? item.risks : [item.risks]) : []).join(' · ')}</p></div>
      </div>
    </article>
  `).join('');
}

function renderPremises(items) {
  premiseList.innerHTML = items.map((premise) => `
    <label class="premise">
      <span>
        <strong>${premise.name || premise.label || premise.nome}</strong>
        <small>Source: ${premise.source || premise.origem} · Status: ${premise.status || premise.estado}</small>
      </span>
      <input data-key="${premise.key || premise.id}" value="${premise.value ?? premise.valor}" />
    </label>
  `).join('');
}

export function renderAnalysis(data) {
  renderClimate(data.climate);
  renderIndicators(data.indicators);
  renderStrategies(data.strategies || data.estrategias);
  renderPremises(data.premises || data.premissas);
  const limitationsList = data.metadata?.limitations || data.metadata?.warnings || [];
  limitations.textContent = `Limitations: ${limitationsList.join(' · ')}. ${data.indicators?.note || ''}`;
}
