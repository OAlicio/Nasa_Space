async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.erro?.mensagem || data.message || 'Could not complete the request.');
  return data;
}

export function createAnalysis(payload) {
  return request('/api/analyses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export function updatePremises(id, premises) {
  return request(`/api/analyses/${id}/premises`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(premises)
  });
}