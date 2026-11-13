export function getElements() {
  return {
    metrics: document.querySelector('#metrics'),
    recommendations: document.querySelector('#recommendations'),
    status: document.querySelector('#status'),
    form: document.querySelector('#analysis-form'),
    results: document.querySelector('#results'),
    premiseList: document.querySelector('#premise-list'),
    indicatorGrid: document.querySelector('#indicator-grid'),
    period: document.querySelector('#period'),
    limitations: document.querySelector('#limitations')
  };
}