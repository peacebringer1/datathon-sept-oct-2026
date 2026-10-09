import { startAppLoading } from './loadingIndicator.js';

const API_BASE_URL = window.API_BASE_URL || `http://127.0.0.1:${new URLSearchParams(window.location.search).get('apiPort') || '5000'}`;
const chartInstances = new Map();
const chartColors = ['#17b981', '#50b9d2', '#46cbb0', '#7fdef5', '#7ef5ad', '#13966d'];

async function getJson(path) {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    let response;
    try {
      response = await fetch(`${API_BASE_URL}${path}`);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }

    const result = await response.json().catch(() => ({}));
    if (response.ok) return result;
    lastError = new Error(result.error || `Ошибка загрузки ${path}`);
    if (response.status < 500) throw lastError;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw lastError || new Error(`Сервер не ответил: ${path}`);
}

function chartFor(id, items) {
  const element = document.getElementById(id);
  if (!element || !window.echarts || !items?.length) return;
  const cleaned = items
    .filter((item) => Number.isFinite(Number(item.value)) && Number(item.value) >= 0)
    .slice(0, 6);
  if (!cleaned.length) return;

  let chart = chartInstances.get(element);
  if (!chart) {
    chart = window.echarts.init(element);
    chartInstances.set(element, chart);
  }
  chart.setOption({
    animationDuration: 650,
    grid: { left: 1, right: 2, top: 5, bottom: 3, containLabel: false },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const item = params[0];
        return `${item.name}<br><strong>${Number(item.value).toLocaleString('ru-RU')}${item.data.suffix || ''}</strong>`;
      }
    },
    xAxis: { type: 'value', show: false, max: (value) => value.max || 1 },
    yAxis: { type: 'category', data: cleaned.map((item) => item.name), show: false, inverse: true },
    series: [{
      type: 'bar',
      data: cleaned.map((item, index) => ({ value: Number(item.value), suffix: item.suffix || '', itemStyle: { color: chartColors[index % chartColors.length], borderRadius: [0, 8, 8, 0] } })),
      barWidth: 9,
      showBackground: true,
      backgroundStyle: { color: 'rgba(184,214,160,.13)', borderRadius: 8 },
      itemStyle: { borderRadius: [0, 8, 8, 0] }
    }]
  });
}

function setStat(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function countLabel(value, unit) {
  return `${Number(value || 0).toLocaleString('ru-RU')} ${unit}`;
}

async function loadD008() {
  const options = await getJson('/api/d008/options');
  const year = options.years?.includes('2024') ? '2024' : options.years?.[0];
  if (!year) throw new Error('Нет доступных годов');
  const data = await getJson(`/api/d008/data?year=${encodeURIComponent(year)}`);
  chartFor('homeChartD008', (data.settlement || []).map((item) => ({ name: item.label, value: item.count })));
  setStat('homeStatD008', `${countLabel(data.people, 'чел.')} · ${year}`);
}

async function loadD006() {
  const options = await getJson('/api/d006/options');
  const year = options.years?.includes('2024') ? '2024' : options.years?.[0];
  if (!year) throw new Error('Нет доступных годов');
  const data = await getJson(`/api/d006/data?year=${encodeURIComponent(year)}`);
  chartFor('homeChartD006', (data.home_types || []).map((item) => ({ name: item.label, value: item.share, suffix: '%' })));
  setStat('homeStatD006', `${countLabel(data.respondents, 'анкет')} · ${year}`);
}

async function loadD002() {
  const options = await getJson('/api/d002/options');
  const year = options.years?.includes('2024') ? '2024' : options.years?.[0];
  const form = options.forms?.find((item) => item.id === 'subject')?.id || options.forms?.[0]?.id;
  if (!year || !form) throw new Error('Нет доступных годов или разделов');
  const data = await getJson(`/api/d002/data?year=${encodeURIComponent(year)}&form=${encodeURIComponent(form)}`);
  const question = data.questions?.find((item) => item.distribution?.length);
  chartFor('homeChartD002', (question?.distribution || []).map((item) => ({ name: item.label, value: item.share, suffix: '%' })));
  setStat('homeStatD002', `${countLabel(data.respondents, 'участников')} · ${year}`);
}

async function loadD004() {
  const options = await getJson('/api/d004/options');
  const year = options.years?.includes('2024') ? '2024' : options.years?.[0];
  const module = options.modules?.[0]?.id || 1;
  if (!year) throw new Error('Нет доступных годов');
  const data = await getJson(`/api/d004/data?year=${encodeURIComponent(year)}&quarter=4kv&module=${encodeURIComponent(module)}&page=1&page_size=10`);
  chartFor('homeChartD004', (data.territory_summary || [])
    .slice().sort((a, b) => Number(b.records) - Number(a.records)).slice(0, 6)
    .map((item) => ({ name: item.territory, value: item.records })));
  setStat('homeStatD004', `${countLabel(data.households, 'домохозяйств')} · ${year}`);
}

async function loadPreview(loader, chartId, statId) {
  const finishLoading = startAppLoading('Обновляем обзорные графики…');
  try {
    await loader();
  } catch (error) {
    setStat(statId, 'Открыть раздел ↗');
    const element = document.getElementById(chartId);
    if (element) element.title = `Предпросмотр недоступен: ${error.message}`;
  } finally {
    finishLoading();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const previews = [
    [loadD008, 'homeChartD008', 'homeStatD008'],
    [loadD004, 'homeChartD004', 'homeStatD004'],
    [loadD006, 'homeChartD006', 'homeStatD006'],
    [loadD002, 'homeChartD002', 'homeStatD002']
  ];
  previews.forEach(([loader, chartId, statId]) => loadPreview(loader, chartId, statId));
  window.addEventListener('resize', () => chartInstances.forEach((chart) => chart.resize()));
});
