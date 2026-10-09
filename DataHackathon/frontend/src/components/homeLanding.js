const API_BASE_URL = window.API_BASE_URL || `http://127.0.0.1:${new URLSearchParams(window.location.search).get('apiPort') || '5000'}`;
const chartInstances = new Map();
let chartColors = ['#17b981', '#50b9d2', '#46cbb0', '#7fdef5', '#7ef5ad', '#13966d'];
window.addEventListener('app-style-preset-changed', (event) => {
  const palettes = {
    classic: ['#a78bfa', '#7c9cff', '#6ee7f9', '#5be7c4', '#a3f7bd', '#b8a6ff'],
    green: ['#17b981', '#50b9d2', '#46cbb0', '#7fdef5', '#7ef5ad', '#13966d']
  };
  chartColors = palettes[event.detail?.preset] || palettes.green;
});

async function getJson(path) {
  let lastError;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    let response;
    try {
      response = await fetch(`${API_BASE_URL}${path}`);
    } catch (error) {
      lastError = error;
      if (attempt < 11) await new Promise((resolve) => setTimeout(resolve, Math.min(900, 250 + attempt * 100)));
      continue;
    }

    const result = await response.json().catch(() => ({}));
    if (response.ok) return result;
    lastError = new Error(result.error || `Ошибка загрузки ${path}`);
    if (response.status < 500) throw lastError;
    if (attempt < 11) await new Promise((resolve) => setTimeout(resolve, Math.min(900, 250 + attempt * 100)));
  }
  throw lastError || new Error(`Сервер не ответил: ${path}`);
}

async function loadLatestData(defaultPath, optionsPath, makeFallbackPath) {
  try {
    return await getJson(defaultPath);
  } catch (defaultError) {
    const options = await getJson(optionsPath);
    const fallbackPath = makeFallbackPath(options);
    if (!fallbackPath) throw defaultError;
    return getJson(fallbackPath);
  }
}

function chartFor(id, items, type = 'bar') {
  const element = document.getElementById(id);
  if (!element || !window.echarts) return;
  const cleaned = (items || [])
    .filter((item) => Number.isFinite(Number(item.value)) && Number(item.value) >= 0)
    .slice(0, type === 'treemap' ? 10 : 6);

  let chart = chartInstances.get(element);
  if (!chart) {
    chart = window.echarts.init(element);
    chartInstances.set(element, chart);
  }
  if (!cleaned.length) {
    chart.setOption({
      graphic: [{ type: 'text', left: 'center', top: 'middle', style: { text: 'Нет данных для графика', fill: '#8b9298', fontSize: 13, fontWeight: 600 } }]
    }, true);
    return;
  }
  const numberLabel = (item) => `${Number(item.value).toLocaleString('ru-RU')}${item.suffix || ''}`;
  const tooltip = {
    trigger: 'item',
    confine: true,
    backgroundColor: '#202522',
    borderWidth: 0,
    textStyle: { color: '#fff', fontSize: 13 },
    formatter: (params) => {
      const point = Array.isArray(params) ? params[0] : params;
      const item = cleaned.find((entry) => entry.name === point?.name) || cleaned[point?.dataIndex];
      return item ? `${item.name}<br><strong>${numberLabel(item)}</strong>` : '';
    }
  };
  let option;

  if (type === 'donut') {
    option = {
      color: chartColors,
      tooltip,
      series: [{ type: 'pie', radius: ['45%', '78%'], center: ['50%', '52%'], avoidLabelOverlap: true,
        itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 4 }, label: { show: false }, labelLine: { show: false },
        emphasis: { scale: true, scaleSize: 5 }, data: cleaned.map((item) => ({ name: item.name, value: Number(item.value), suffix: item.suffix || '' })) }]
    };
  } else if (type === 'rose') {
    option = {
      color: chartColors,
      tooltip,
      series: [{ type: 'pie', roseType: 'area', radius: ['12%', '78%'], center: ['50%', '52%'],
        itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 4 }, label: { show: false }, labelLine: { show: false },
        emphasis: { scale: true, scaleSize: 4 }, data: cleaned.map((item) => ({ name: item.name, value: Number(item.value), suffix: item.suffix || '' })) }]
    };
  } else if (type === 'treemap') {
    option = {
      color: chartColors,
      tooltip,
      series: [{ type: 'treemap', roam: false, nodeClick: false, breadcrumb: { show: false }, visibleMin: 1,
        label: { show: false }, upperLabel: { show: false }, itemStyle: { borderColor: '#fff', borderWidth: 2, gapWidth: 2 },
        data: cleaned.map((item, index) => ({ name: item.name, value: Number(item.value), itemStyle: { color: chartColors[index % chartColors.length] } })) }]
    };
  } else if (type === 'line') {
    option = {
      color: chartColors,
      animationDuration: 650,
      grid: { left: 4, right: 4, top: 10, bottom: 8, containLabel: false },
      tooltip: { ...tooltip, trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: '#8b9298', type: 'dashed' } } },
      xAxis: { type: 'category', data: cleaned.map((item) => item.name), boundaryGap: false, show: false },
      yAxis: { type: 'value', show: false, min: 0 },
      series: [{ type: 'line', smooth: .35, symbol: 'circle', symbolSize: 9,
        lineStyle: { color: chartColors[4], width: 3 }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(126,245,173,.3)' }, { offset: .5, color: 'rgba(80,185,210,.12)' }, { offset: 1, color: 'rgba(23,185,129,.02)' }] } },
        data: cleaned.map((item, index) => ({ name: item.name, value: Number(item.value), suffix: item.suffix || '', itemStyle: { color: chartColors[index % chartColors.length], borderColor: '#fff', borderWidth: 2 } })) }]
    };
  } else {
    option = {
      color: chartColors,
      animationDuration: 650,
      grid: { left: 3, right: 4, top: 5, bottom: 4, containLabel: false },
      tooltip: { ...tooltip, trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'value', show: false, max: (value) => value.max || 1 },
      yAxis: { type: 'category', data: cleaned.map((item) => item.name), show: false, inverse: true },
      series: [{
        type: 'bar',
        data: cleaned.map((item, index) => ({ name: item.name, value: Number(item.value), suffix: item.suffix || '', itemStyle: { color: chartColors[index % chartColors.length], borderRadius: [0, 7, 7, 0] } })),
        barWidth: '48%',
        showBackground: true,
        backgroundStyle: { color: 'rgba(139,146,152,.12)', borderRadius: 7 },
        itemStyle: { borderRadius: [0, 7, 7, 0] }
      }]
    };
  }
  chart.setOption(option, true);
}

function setStat(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function countLabel(value, unit) {
  return `${Number(value || 0).toLocaleString('ru-RU')} ${unit}`;
}

async function loadD008() {
  const data = await loadLatestData('/api/d008/data?year=2024&preview=1', '/api/d008/options', (options) => {
    const year = options.years?.includes('2024') ? '2024' : options.years?.[0];
    return year ? `/api/d008/data?year=${encodeURIComponent(year)}&preview=1` : '';
  });
  const year = String(data.year || '2024');
  chartFor('homeChartD008', (data.settlement || []).map((item) => ({ name: item.label, value: item.count })), 'donut');
  setStat('homeStatD008', `${countLabel(data.people, 'чел.')} · ${year}`);
}

async function loadD006() {
  const data = await loadLatestData('/api/d006/data?year=2024&preview=1', '/api/d006/options', (options) => {
    const year = options.years?.includes('2024') ? '2024' : options.years?.[0];
    return year ? `/api/d006/data?year=${encodeURIComponent(year)}&preview=1` : '';
  });
  const year = String(data.year || '2024');
  chartFor('homeChartD006', (data.home_types || []).map((item) => ({ name: item.label, value: item.share, suffix: '%' })), 'treemap');
  setStat('homeStatD006', `${countLabel(data.respondents, 'анкет')} · ${year}`);
}

async function loadD002() {
  const data = await loadLatestData('/api/d002/data?year=2024&form=subject&preview=1', '/api/d002/options', (options) => {
    const year = options.years?.includes('2024') ? '2024' : options.years?.[0];
    const form = options.forms?.find((item) => item.id === 'subject')?.id || options.forms?.[0]?.id;
    return year && form ? `/api/d002/data?year=${encodeURIComponent(year)}&form=${encodeURIComponent(form)}&preview=1` : '';
  });
  const year = String(data.year || '2024');
  const question = data.questions?.find((item) => item.distribution?.length);
  chartFor('homeChartD002', (question?.distribution || []).map((item) => ({ name: item.label, value: item.share, suffix: '%' })), question?.is_satisfaction_scale ? 'line' : 'rose');
  setStat('homeStatD002', `${countLabel(data.respondents, 'участников')} · ${year}`);
}

async function loadD004() {
  const data = await loadLatestData('/api/d004/data?year=2024&quarter=all&module=1&page=1&page_size=10', '/api/d004/options', (options) => {
    const year = options.years?.includes('2024') ? '2024' : options.years?.[0];
    const module = options.modules?.some((item) => String(item.id) === '1') ? 1 : options.modules?.[0]?.id;
    return year && module != null ? `/api/d004/data?year=${encodeURIComponent(year)}&quarter=all&module=${encodeURIComponent(module)}&page=1&page_size=10` : '';
  });
  const year = String(data.year || '2024');
  chartFor('homeChartD004', (data.territory_summary || [])
    .slice().sort((a, b) => Number(b.records) - Number(a.records)).slice(0, 6)
    .map((item) => ({ name: item.territory, value: item.records })));
  setStat('homeStatD004', `${countLabel(data.households, 'домохозяйств')} · ${year}`);
}

async function loadPreview(loader, chartId, statId) {
  const chart = document.getElementById(chartId);
  chart?.classList.add('is-loading');
  chart?.classList.remove('has-error');
  if (chart) delete chart.dataset.message;
  try {
    await loader();
  } catch (error) {
    setStat(statId, 'Открыть раздел ↗');
    if (chart) {
      chart.classList.add('has-error');
      chart.dataset.message = 'Не удалось загрузить';
      chart.title = `Предпросмотр недоступен: ${error.message}`;
    }
  } finally {
    chart?.classList.remove('is-loading');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const previews = [
    [loadD008, 'homeChartD008', 'homeStatD008'],
    [loadD006, 'homeChartD006', 'homeStatD006'],
    [loadD002, 'homeChartD002', 'homeStatD002']
  ];
  setStat('homeStatD004', 'Открыть набор ↗');
  previews.forEach(([loader, chartId, statId]) => {
    loadPreview(loader, chartId, statId);
  });
  window.addEventListener('resize', () => chartInstances.forEach((chart) => chart.resize()));
});
