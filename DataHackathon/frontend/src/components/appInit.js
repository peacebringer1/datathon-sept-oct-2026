import { updateStackedAreaChart } from './chartsMap.js';
import { loadTablePage } from './table.js';
import { fetchAIInsights } from './insightsTicker.js';
import { updateChartAnalysis } from './chartAnalysis.js';

function replaceSelectOptions(selectElement, values, formatValue = (value) => value) {
  if (!selectElement) return;
  const fragment = document.createDocumentFragment();
  values.forEach((value) => {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = formatValue(value);
    fragment.appendChild(option);
  });
  selectElement.replaceChildren(fragment);
}

export async function initApp(apiBaseUrl, callbacks) {
  try {
    const res = await fetch(`${apiBaseUrl}/api/init-filters`);
    const { indicators, years } = await res.json();

    const datedYears = years.filter((year) => Number(year) > 0);

    const regionIndEl = document.getElementById('regionIndicatorSelect');
    const regionYearEl = document.getElementById('regionYearSelect');
    const mapIndEl = document.getElementById('mapIndicatorSelect');
    const mapYearEl = document.getElementById('mapYearSelect');
    const summaryIndEl = document.getElementById('summaryIndicatorSelect');

    replaceSelectOptions(regionIndEl, indicators);
    replaceSelectOptions(regionYearEl, datedYears, (year) => `${year} год`);
    replaceSelectOptions(mapIndEl, indicators);
    replaceSelectOptions(mapYearEl, datedYears, (year) => `${year} год`);
    replaceSelectOptions(summaryIndEl, indicators);

    populateAllSelectors(indicators, datedYears);

    if (callbacks.onRegionFilterChange) await callbacks.onRegionFilterChange();
    if (callbacks.onMapFilterChange) await callbacks.onMapFilterChange();
    if (callbacks.onSummaryFilterChange) await callbacks.onSummaryFilterChange();

    const card5Ind = document.getElementById('card5Indicator')?.value || indicators[0];
    const card5Year = document.getElementById('card5Year')?.value || years[0];
    if (card5Ind && card5Year) {
      await updateStackedAreaChart(apiBaseUrl, card5Ind, card5Year);
      const activeCategory = document.querySelector('.cat-header.active .cat-text')?.textContent?.trim();
      if (!window.activeAnalyzerDataset) {
        updateChartAnalysis('barAnimationChart', apiBaseUrl, card5Ind, activeCategory || 'Общие данные', card5Year);
      }
    }

    loadTablePage(apiBaseUrl);
    fetchAIInsights(apiBaseUrl);
  } catch (err) {
    console.warn('Ожидание запуска Flask-сервера...', err);
    setTimeout(() => initApp(apiBaseUrl, callbacks), 1000);
  }
}

export function populateAllSelectors(indicatorsList, yearsList) {
  const datedYears = yearsList.filter((year) => Number(year) > 0);

  const regionIndEl = document.getElementById('regionIndicatorSelect');
  const regionYearEl = document.getElementById('regionYearSelect');
  replaceSelectOptions(regionIndEl, indicatorsList);
  replaceSelectOptions(regionYearEl, datedYears, (year) => `${year} год`);

  for (let i = 1; i <= 6; i++) {
    const indEl = document.getElementById(`card${i}Indicator`);
    const yearEl = document.getElementById(`card${i}Year`);
    
    if (indEl) {
      const currentInd = indEl.value;
      replaceSelectOptions(indEl, indicatorsList);
      if (currentInd) indEl.value = currentInd;
      if (!indEl.value) indEl.selectedIndex = 0;
    }
    if (yearEl) {
      const currentYear = yearEl.value;
      replaceSelectOptions(yearEl, datedYears, (year) => `${year} год`);
      if (currentYear) yearEl.value = currentYear;
      if (!yearEl.value) yearEl.selectedIndex = 0;
    }
  }
}

export function setSelectValuePrecise(selectElement, targetValue) {
  if (!selectElement || !selectElement.options.length) return;
  const cleanTarget = targetValue.trim().toLowerCase();
  
  let bestMatch = selectElement.options[0].value;

  for (let opt of selectElement.options) {
    const optVal = opt.value.trim().toLowerCase();
    if (optVal.includes(cleanTarget)) {
      bestMatch = opt.value;
      break;
    }
  }
  selectElement.value = bestMatch;
}
