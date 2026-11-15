import { getElements } from './dom.js';
import { createAnalysis, updatePremises } from './api.js';
import { renderAnalysis } from './renderers.js';

const { form, results, status } = getElements();
let analysis = null;

function showStatus(message, type = 'loading') {
  status.hidden = false;
  status.textContent = message;
  status.className = `status ${type}`;
}

function displayAnalysis(data) {
  analysis = data;
  renderAnalysis(data);
  results.hidden = false;
  form.hidden = true;
  showStatus(`Analysis version ${data.version || data.versao_analise} ready · ${data.climate?.source || 'NASA POWER'}`, 'success');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showStatus('Retrieving NASA satellite precipitation, temperature, and local indicators...', 'loading');
  const payload = Object.fromEntries(new FormData(form));
  payload.seasons = Number(payload.seasons);
  payload.areaHa = Number(payload.areaHa);
  try {
    displayAnalysis(await createAnalysis(payload));
  } catch (error) {
    showStatus(error.message, 'error');
  }
});

document.querySelector('#recalculate').addEventListener('click', async () => {
  const soil = document.querySelector('[data-key="soil"]')?.value || 'loam';
  showStatus('Recalculating rotation scores with updated premises...', 'loading');
  try {
    displayAnalysis(await updatePremises(analysis.id, { soil }));
  } catch (error) {
    showStatus(error.message, 'error');
  }
});

document.querySelector('#new-analysis').addEventListener('click', () => {
  results.hidden = true;
  form.hidden = false;
  status.hidden = true;
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
