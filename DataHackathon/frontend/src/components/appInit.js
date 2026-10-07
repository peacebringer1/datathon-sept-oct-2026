import { updateStackedAreaChart } from './chartsMap.js';
import { loadTablePage } from './table.js';
import { fetchAIInsights } from './insightsTicker.js';
import { updateChartAnalysis } from './chartAnalysis.js';

export async function initApp(apiBaseUrl, callbacks) {
  try {
    const res = await fetch(`${apiBaseUrl}/api/init-filters`);
    const { indicators, years } = await res.json();

    const optionsHTML = indicators.map(ind => `<option value="${ind}">${ind}</option>`).join('');
    const yearsHTML = years.map(y => `<option value="${y}">${Number(y) > 0 ? `${y} год` : 'Все годы'}</option>`).join('');

    const regionIndEl = document.getElementById('regionIndicatorSelect');
    const regionYearEl = document.getElementById('regionYearSelect');
    const mapIndEl = document.getElementById('mapIndicatorSelect');
    const mapYearEl = document.getElementById('mapYearSelect');
    const summaryIndEl = document.getElementById('summaryIndicatorSelect');

    if (regionIndEl) regionIndEl.innerHTML = optionsHTML;
    if (regionYearEl) regionYearEl.innerHTML = yearsHTML;
    if (mapIndEl) mapIndEl.innerHTML = optionsHTML;
    if (mapYearEl) mapYearEl.innerHTML = yearsHTML;
    if (summaryIndEl) summaryIndEl.innerHTML = optionsHTML;

    populateAllSelectors(indicators, years);

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
  const optionsHTML = indicatorsList.map(ind => `<option value="${ind}">${ind}</option>`).join('');
  const yearsHTML = yearsList.map(y => `<option value="${y}">${Number(y) > 0 ? `${y} год` : 'Все годы'}</option>`).join('');

  const regionIndEl = document.getElementById('regionIndicatorSelect');
  const regionYearEl = document.getElementById('regionYearSelect');
  if (regionIndEl) regionIndEl.innerHTML = optionsHTML;
  if (regionYearEl) regionYearEl.innerHTML = yearsHTML;

  for (let i = 1; i <= 6; i++) {
    const indEl = document.getElementById(`card${i}Indicator`);
    const yearEl = document.getElementById(`card${i}Year`);
    
    if (indEl) {
      const currentInd = indEl.value;
      indEl.innerHTML = optionsHTML;
      if (currentInd) indEl.value = currentInd;
      if (!indEl.value) indEl.selectedIndex = 0;
    }
    if (yearEl) {
      const currentYear = yearEl.value;
      yearEl.innerHTML = yearsHTML;
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