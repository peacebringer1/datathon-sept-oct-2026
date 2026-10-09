const PAGE_CONFIG = {
  t001: {
    title: 'Труд и занятость',
    breadcrumb: 'Экономика · Труд и занятость',
    description: 'Данные обследования предприятий и работников. Выберите раздел слева, чтобы открыть соответствующий набор.'
  },
  '2t': {
    title: 'Заработная плата',
    breadcrumb: 'Экономика · Заработная плата',
    description: 'Статистика заработной платы. Страница раздела открывается отдельно от общего дашборда.'
  },
  d008: {
    title: 'Демография',
    breadcrumb: 'Население · Демография',
    description: 'Возрастной и социальный состав участников обследования домохозяйств: пол, родство, образование, семейное положение и основная деятельность.'
  },
  d004: {
    title: 'Доходы и расходы домохозяйств',
    breadcrumb: 'Население · Уровень жизни · D004',
    description: 'Ежеквартальное обследование доходов и расходов домашних хозяйств. Данные сгруппированы по году, кварталу и разделу анкеты.'
  },
  d006: {
    title: 'Жилищные условия',
    breadcrumb: 'Население · Жилищные условия',
    description: 'Ежегодный опрос о типе и площади жилья, коммунальных удобствах, собственности, доступе к земле и имуществе домохозяйств.'
  },
  d002: {
    title: 'Социальные оценки',
    breadcrumb: 'Население · Социальные оценки · D002',
    description: 'Ежегодное обследование о том, как люди оценивают свою жизнь, какие условия и услуги им доступны и с какими трудностями сталкиваются домохозяйства.'
  }
};

let DATA_COLORS = ['#d94343', '#f28c28', '#f2c94c', '#a8cf45', '#3e9b59', '#8b9298'];
let MAP_SCALE = ['#d94343', '#f28c28', '#f2c94c', '#a8cf45', '#3e9b59'];
window.addEventListener('app-style-preset-changed', (event) => {
  const palettes = {
    classic: ['#fbb085', '#c9aace', '#a88db1', '#df987d', '#e5c2ac', '#8b9298'],
    green: ['#d94343', '#f28c28', '#f2c94c', '#a8cf45', '#3e9b59', '#8b9298']
  };
  const mapPalettes = {
    classic: ['#a88db1', '#c9aace', '#ead7d0', '#f5c6a5', '#fbb085'],
    green: ['#d94343', '#f28c28', '#f2c94c', '#a8cf45', '#3e9b59']
  };
  DATA_COLORS = palettes[event.detail?.preset] || palettes.green;
  MAP_SCALE = mapPalettes[event.detail?.preset] || mapPalettes.green;
});

async function fetchDatasetYearData(path, years, params = {}) {
  const results = [];
  for (const year of years) {
    const query = new URLSearchParams({ ...params, year });
    const response = await fetch(`${activeApiUrl}${path}?${query}`);
    const result = await response.json().catch(() => ({}));
    if (response.ok) results.push(result);
  }
  if (!results.length) throw new Error('За выбранные годы данные не найдены.');
  return results;
}

let activeApiUrl = '';
let currentPage = 1;
let totalRows = 0;
let d004Chart = null;
let d002Charts = new Map();
let d002ChartObserver = null;
let d002Questions = [];
let d002Respondents = 0;
let d002FilteredQuestions = [];
let d002QuestionIndex = 0;
let d002Map = null;
let d002MapGeoJSON = null;
let d002MapRevision = 0;
let d002MapRegions = [];
let d006Charts = new Map();
let d008Charts = new Map();
let d008AvailableYears = [];
let d008RequestId = 0;
let d008BaseResults = [];
let d004Map = null;
let d004MapResizeObserver = null;
let d004GeoJSON = null;
let d004MapSummary = [];
let d004MapPeriod = '';
let d004MapMetricValue = 'records';
let d004SelectedRegion = '';
let d004QuestionnaireObserver = null;
let d004QuestionnaireRevision = 0;

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function appendOptions(select, items, valueOf, labelOf) {
  const previousValue = select.value;
  select.replaceChildren();
  items.forEach((item) => {
    const option = document.createElement('option');
    option.value = valueOf(item);
    option.textContent = labelOf(item);
    select.append(option);
  });
  if ([...select.options].some((option) => option.value === previousValue)) select.value = previousValue;
}

function preferredDatasetYear(years) {
  return ['2024', '2023', '2022', '2021'].find((year) => years.includes(year)) || years[0];
}

function disposeD002Charts() {
  if (d002ChartObserver) d002ChartObserver.disconnect();
  d002ChartObserver = null;
  d002Charts.forEach((chart) => chart.dispose());
  d002Charts.clear();
}

function renderD002QuestionChart(element, question) {
  if (!element || !window.echarts || !question?.distribution?.length) return;
  const chart = window.echarts.init(element);
  d002Charts.set(element, chart);
  const styles = getComputedStyle(element.closest('.dataset-panel') || element);
  const textColor = styles.getPropertyValue('--text-primary').trim() || '#222222';
  const years = question.yearly?.length ? question.yearly : [question];
  const categories = new Map();
  years.forEach((item) => (item.distribution || []).forEach((answer) => categories.set(String(answer.code ?? answer.label), answer.label)));
  const isTrend = years.length > 1;
  const valueKey = document.getElementById('d002ValueMode')?.value || 'share';
  const suffix = valueKey === 'share' ? '%' : '';
  chart.setOption({
    color: DATA_COLORS,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const points = Array.isArray(params) ? params : [params];
        return `${points[0]?.axisValue || ''}<br>${points.map((point) => `${point.marker}${point.seriesName}: <strong>${Number(point.value).toLocaleString('ru-RU')}${suffix}</strong>`).join('<br>')}`;
      }
    },
    legend: { type: 'scroll', bottom: 0, left: 10, right: 10, textStyle: { color: textColor, fontSize: 12 } },
    toolbox: { right: 8, feature: { dataView: { readOnly: true }, restore: {}, saveAsImage: {} } },
    dataZoom: [{ type: 'inside', start: 0, end: 100 }, { type: 'slider', height: 18, bottom: 34, start: 0, end: 100 }],
    grid: { left: 58, right: 24, top: 28, bottom: 95, containLabel: true },
    xAxis: { type: 'category', boundaryGap: !isTrend, data: isTrend ? years.map((item) => String(item.year)) : [...categories.values()], axisLabel: { color: textColor, interval: 0, rotate: !isTrend && categories.size > 6 ? 25 : 0, hideOverlap: true } },
    yAxis: { type: 'value', min: 0, max: valueKey === 'share' ? 100 : undefined, minInterval: valueKey === 'count' ? 1 : undefined, axisLabel: { color: textColor, formatter: (value) => `${Number(value).toLocaleString('ru-RU')}${suffix}` }, splitLine: { lineStyle: { color: 'rgba(139,146,152,.2)' } } },
    series: isTrend ? [...categories.entries()].map(([code, name]) => ({
      name, type: 'bar', emphasis: { focus: 'series' },
      data: years.map((item) => {
        const answer = (item.distribution || []).find((entry) => String(entry.code ?? entry.label) === code);
        return answer ? Number(answer[valueKey] || 0) : null;
      })
    })) : [{
      name: valueKey === 'share' ? 'Доля ответов' : 'Число ответов',
      type: 'bar',
      data: [...categories.keys()].map((code) => Number((years[0].distribution || []).find((entry) => String(entry.code ?? entry.label) === code)?.[valueKey] || 0))
    }]
  }, true);
  chart.resize();
}

function renderD002Question() {
  const query = document.getElementById('d002QuestionSearch').value.trim().toLocaleLowerCase('ru-RU');
  d002FilteredQuestions = d002Questions.filter((question) => `${question.label} ${question.id}`.toLocaleLowerCase('ru-RU').includes(query));
  if (d002QuestionIndex >= d002FilteredQuestions.length) d002QuestionIndex = Math.max(0, d002FilteredQuestions.length - 1);
  disposeD002Charts();
  const question = d002FilteredQuestions[d002QuestionIndex];
  const empty = !question;
  document.getElementById('d002NoResults').hidden = !empty;
  document.getElementById('d002QuestionChart').hidden = empty;
  document.getElementById('d002QuestionInfo').hidden = empty;
  document.getElementById('d002PreviousQuestion').disabled = empty || d002QuestionIndex === 0;
  document.getElementById('d002NextQuestion').disabled = empty || d002QuestionIndex >= d002FilteredQuestions.length - 1;
  setText('d002QuestionPosition', empty ? 'Вопросов не найдено' : `Вопрос ${d002QuestionIndex + 1} из ${d002FilteredQuestions.length}`);
  if (empty) {
    setText('d002CurrentQuestionTitle', '');
    setText('d002CurrentQuestionCode', '');
    document.getElementById('d002MapPanel').hidden = true;
    d002MapRevision += 1;
    return;
  }
  setText('d002CurrentQuestionTitle', question.label);
  setText('d002QuestionInfoTitle', question.label);
  setText('d002CurrentQuestionCode', question.id);
  setText('d002AnsweredCount', Number(question.answered).toLocaleString('ru-RU'));
  setText('d002MissingCount', Number(question.missing).toLocaleString('ru-RU'));
  setText('d002AnswerRate', `${d002Respondents ? Math.round(question.answered / d002Respondents * 1000) / 10 : 0}%`);
  setText('d002QuestionNote', question.chart_note || 'Доля рассчитана среди участников, ответивших на этот вопрос.');
  setText('d002ChartCaption', question.yearly?.length > 1
    ? `Столбцы сравнивают ответы по годам. Значения каждого года показаны отдельно и не суммируются.`
    : `${Number(question.answered).toLocaleString('ru-RU')} ответов. Столбцы показывают варианты ответа в ${question.year || 'выбранном году'}.`);
  renderD002QuestionChart(document.getElementById('d002QuestionChart'), question);
  renderD002Map(question);
}

const d002RegionCoordinates = {
  '10': [80.23, 50.41], '11': [69.39, 53.28], '15': [57.2, 50.28], '19': [76.96, 43.86],
  '23': [51.92, 47.11], '27': [51.37, 51.23], '31': [71.37, 42.9], '33': [78.37, 45.02],
  '35': [73.1, 49.8], '39': [63.63, 53.21], '43': [65.5, 44.85], '47': [51.16, 43.65],
  '51': [68.27, 43.3], '55': [76.95, 52.28], '59': [69.15, 54.87], '61': [68.27, 43.3],
  '62': [67.71, 47.78], '63': [82.62, 49.95], '71': [71.43, 51.17], '75': [76.95, 43.24],
  '79': [69.6, 42.32]
};

async function renderD002Map(question) {
  const panel = document.getElementById('d002MapPanel');
  const chartElement = document.getElementById('d002MapChart');
  const revision = ++d002MapRevision;
  if (!Number(document.getElementById('d002TerritoriesStat').textContent.replace(/\D/g, '')) || !question.distribution?.length) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const params = new URLSearchParams({
    year: document.getElementById('d002YearSelect').value,
    form: document.getElementById('d002FormSelect').value,
    question: question.id
  });
  setText('d002MapStatus', 'Считаем доли ответов по территориям…');
  setText('d002RegionTitle', 'Выберите область на карте');
  document.getElementById('d002RegionStats').hidden = true;
  let response;
  try {
    const selectedYear = document.getElementById('d002YearSelect').value;
    let result;
    const mapYear = selectedYear === 'trend' ? question.yearly?.at(-1)?.year : selectedYear;
    params.set('year', mapYear || selectedYear);
    response = await fetch(`${activeApiUrl}/api/d002/map?${params}`);
    result = await response.json().catch(() => ({}));
    if (revision !== d002MapRevision) return;
    if (response && !response.ok) {
      const serverMessage = result.error ? ` Сервер сообщил: ${result.error}` : '';
      const restartHint = response.status === 404
        ? ' Перезапустите приложение целиком, чтобы Flask загрузил маршрут карты.'
        : '';
      throw new Error(`Flask API вернул HTTP ${response.status}.${serverMessage}${restartHint}`);
    }
    if (!result?.regions?.length || !result.categories?.length) {
      panel.hidden = true;
      return;
    }
    d002MapRegions = result.regions;
    setText('d002MapStatus', 'Каждый круг — область. Прокручивайте колёсико, чтобы приблизить карту; перетаскивайте её мышью или пальцем. Нажмите на круг для подробностей.');
    if (!window.echarts) throw new Error('Библиотека ECharts недоступна.');
    d002Map = window.echarts.getInstanceByDom(chartElement) || window.echarts.init(chartElement);
    if (!d002MapGeoJSON) {
      const geoResponse = await fetch('https://raw.githubusercontent.com/artemnovichkov/KazakhstanMapExample/main/KazakhstanMapExample/kazakhstan.geojson');
      if (!geoResponse.ok) throw new Error('Не удалось загрузить границы Казахстана.');
      d002MapGeoJSON = await geoResponse.json();
      window.echarts.registerMap('KZ_D002', d002MapGeoJSON);
    }
    if (revision !== d002MapRevision) return;
    const dark = document.body.classList.contains('dark-theme');
    const colors = DATA_COLORS;
    d002Map.setOption({
      color: colors,
      tooltip: {
        trigger: 'item',
        formatter: (item) => {
          const region = d002MapRegions.find((entry) => entry.code === item.data?.regionCode);
          return region && item.data?.count != null
            ? `${region.territory}<br>${item.name}: ${item.data.count} (${item.data.share}%)<br>Всего ответов: ${region.answered}`
            : `${item.seriesName || item.name}`;
        }
      },
      legend: {
        type: 'scroll', bottom: 2, left: 'center', data: result.categories.map((item) => item.label),
        textStyle: { color: dark ? '#d4e4d4' : '#48534b', fontSize: 13 },
        pageTextStyle: { color: dark ? '#d4e4d4' : '#48534b' }
      },
      geo: {
        map: 'KZ_D002', roam: true, zoom: 1,
        layoutCenter: [' 0%', '130%'], layoutSize: '297%',
        itemStyle: { areaColor: dark ? '#48534b' : '#8b9298', borderColor: dark ? '#b8d6a0' : '#40684c', borderWidth: 1.1 },
        emphasis: { itemStyle: { areaColor: dark ? '#34584d' : '#d4e4d4' }, label: { show: true, color: dark ? '#fff' : '#293a30', fontSize: 13 } },
        label: { show: false }
      },
      series: result.regions.filter((region) => d002RegionCoordinates[region.code]).map((region) => ({
        name: region.territory,
        type: 'pie',
        coordinateSystem: 'geo',
        geoIndex: 0,
        center: d002RegionCoordinates[region.code],
        radius: 18,
        minShowLabelAngle: 8,
        avoidLabelOverlap: true,
        itemStyle: { borderColor: dark ? '#2c282d' : '#fff', borderWidth: 1, borderRadius: 2 },
        label: { show: false },
        emphasis: { scale: true, scaleSize: 5, label: { show: true, formatter: '{b}\n{d}%', color: dark ? '#fff' : '#293a30', fontSize: 13, fontWeight: 700 } },
        data: region.distribution.map((answer) => ({
          name: answer.label, value: answer.count, share: answer.share,
          count: answer.count, regionCode: region.code
        }))
      }))
    }, true);
    d002Map.off('click');
    d002Map.on('click', (params) => {
      const region = d002MapRegions.find((entry) => entry.territory === params.seriesName);
      if (region) showD002RegionDetails(region);
    });
    d002Map.resize();
    setText('d002MapCaption', `${question.label} · ${mapYear}. Карта показывает распределение ответов за этот год; круги по регионам не суммируются по периодам.`);
  } catch (error) {
    if (revision !== d002MapRevision) return;
    const networkHint = response ? '' : ' Проверьте, запущен ли Flask-сервер.';
    setText('d002MapStatus', `${error.message}${networkHint}`);
  }
}

function showD002RegionDetails(region) {
  setText('d002RegionTitle', region.territory);
  const description = document.getElementById('d002RegionDescription');
  const stats = document.getElementById('d002RegionStats');
  description.textContent = `Распределение ответов среди ${Number(region.answered).toLocaleString('ru-RU')} участников этой территории.`;
  stats.replaceChildren();
  const total = document.createElement('article');
  total.className = 'd002-region-total';
  const totalLabel = document.createElement('span');
  totalLabel.textContent = `Всего ответов · код ${region.code}`;
  const totalValue = document.createElement('strong');
  totalValue.textContent = Number(region.answered).toLocaleString('ru-RU');
  total.append(totalLabel, totalValue);
  stats.append(total);
  const palette = DATA_COLORS;
  region.distribution.forEach((item, index) => {
    const row = document.createElement('article');
    row.className = 'd002-region-answer';
    row.style.setProperty('--answer-color', palette[index % palette.length]);
    const heading = document.createElement('div');
    heading.className = 'd002-region-answer-heading';
    const label = document.createElement('span');
    label.textContent = item.label;
    const value = document.createElement('strong');
    value.textContent = `${Number(item.count).toLocaleString('ru-RU')} · ${item.share}%`;
    heading.append(label, value);
    const track = document.createElement('div');
    track.className = 'd002-region-answer-track';
    track.setAttribute('aria-hidden', 'true');
    const bar = document.createElement('span');
    bar.style.width = `${Math.max(0, Math.min(100, Number(item.share) || 0))}%`;
    track.append(bar);
    row.append(heading, track);
    stats.append(row);
  });
  stats.hidden = false;
}

function renderD006Pie(id, items) {
  renderD006Bars(id, items, 'share', '%');
}

function renderD006Bars(id, items, valueKey, valueSuffix = '') {
  const element = document.getElementById(id);
  if (!element || !window.echarts || !items.length) return;
  const chart = window.echarts.init(element);
  d006Charts.set(id, chart);
  const styles = getComputedStyle(element.closest('.d006-chart-panel'));
  const textColor = styles.getPropertyValue('--text-primary').trim() || '#222222';
  const sorted = [...items].sort((a, b) => Number(b[valueKey]) - Number(a[valueKey]));
  chart.setOption({
    color: DATA_COLORS,
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params) => `${params[0].name}<br>${Number(params[0].value).toLocaleString('ru-RU')}${valueSuffix}` },
    grid: { left: 16, right: 70, top: 12, bottom: 14, containLabel: true },
    dataZoom: [
      { type: 'inside', yAxisIndex: 0, startValue: 0, endValue: Math.min(items.length - 1, 17), filterMode: 'none', zoomOnMouseWheel: false, moveOnMouseWheel: true },
      { type: 'slider', yAxisIndex: 0, startValue: 0, endValue: Math.min(items.length - 1, 17), right: 8, width: 9, showDetail: false, brushSelect: false, borderColor: 'transparent', backgroundColor: 'rgba(184,214,160,.12)', fillerColor: 'rgba(184,214,160,.35)', handleStyle: { color: '#b8d6a0' }, textStyle: { color: textColor } }
    ],
    xAxis: { type: 'value', max: valueSuffix === '%' ? 100 : undefined, axisLabel: { color: textColor, formatter: valueSuffix === '%' ? '{value}%' : '{value}' }, splitLine: { lineStyle: { type: 'dashed', color: 'rgba(184,214,160,.23)' } } },
    yAxis: { type: 'category', inverse: true, data: sorted.map((item) => item.label), axisLabel: { color: textColor, width: 270, overflow: 'truncate', fontSize: 13 }, axisLine: { show: false }, axisTick: { show: false } },
    series: [{ type: 'bar', data: sorted.map((item, index) => ({ value: item[valueKey], itemStyle: { color: DATA_COLORS[index % DATA_COLORS.length] } })), barMaxWidth: 20, showBackground: true, backgroundStyle: { color: 'rgba(139,146,152,.11)', borderRadius: [0, 7, 7, 0] }, itemStyle: { borderRadius: [0, 7, 7, 0] }, label: { show: true, position: 'right', color: textColor, fontSize: 13, formatter: ({ value }) => `${Number(value).toLocaleString('ru-RU')}${valueSuffix}` } }]
  });
  chart.resize();
}

function disposeD006Charts() {
  d006Charts.forEach((chart) => chart.dispose());
  d006Charts.clear();
}

async function loadD006Page() {
  const status = document.getElementById('d006Status');
  const year = document.getElementById('d006YearSelect').value;
  status.dataset.state = 'loading';
  status.textContent = 'Загружаем данные о жилищных условиях…';
  try {
    let result;
    const response = await fetch(`${activeApiUrl}/api/d006/data?year=${encodeURIComponent(year)}`);
    result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Не удалось загрузить D006.');
    disposeD006Charts();
    setText('d006RespondentsStat', Number(result.respondents).toLocaleString('ru-RU'));
    setText('d006TerritoriesStat', Number(result.territories).toLocaleString('ru-RU'));
    setText('d006TotalAreaStat', result.average_total_area == null ? '—' : `${Number(result.average_total_area).toLocaleString('ru-RU')} м²`);
    setText('d006LivingAreaStat', result.average_living_area == null ? '—' : `${Number(result.average_living_area).toLocaleString('ru-RU')} м²`);
    setText('d006RoomsStat', result.average_rooms == null ? '—' : Number(result.average_rooms).toLocaleString('ru-RU'));
    renderD006Pie('d006HomeTypeChart', result.home_types);
    renderD006Pie('d006OwnershipChart', result.ownership);
    renderD006Pie('d006SettlementChart', result.city_rural);
    renderD006Pie('d006LandChart', result.land_access);
    renderD006Bars('d006AmenitiesChart', result.amenities, 'share', '%');
    renderD006Bars('d006GoodsChart', result.durable_goods, 'count');
    setText('d006SourceNote', `Год ${result.year}. Источник: ${result.source === 'database.sqlite' ? 'database.sqlite' : 'CSV в data/sinte'}. Средние значения рассчитаны по анкетам с заполненным ответом.`);
    status.dataset.state = 'success';
    status.textContent = `${result.year}: ${Number(result.respondents).toLocaleString('ru-RU')} анкет по ${Number(result.territories).toLocaleString('ru-RU')} территориям.`;
  } catch (error) {
    disposeD006Charts();
    status.dataset.state = 'error';
    status.textContent = error.message;
  }
}

async function initializeD006(apiBaseUrl) {
  activeApiUrl = apiBaseUrl;
  const dashboard = document.getElementById('d006Dashboard');
  try {
    const response = await fetch(`${apiBaseUrl}/api/d006/options`);
    const options = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(options.error || 'Не удалось получить список данных D006.');
    if (!options.years.length) throw new Error('Данные D006 не найдены ни в data/sinte, ни в database.sqlite.');
    appendOptions(document.getElementById('d006YearSelect'), options.years, String, String);
    if (!dashboard.dataset.listenersReady) {
      document.getElementById('d006YearSelect').value = preferredDatasetYear(options.years);
      document.getElementById('d006YearSelect').addEventListener('change', loadD006Page);
      window.addEventListener('resize', () => d006Charts.forEach((chart) => chart.resize()));
      dashboard.dataset.listenersReady = 'true';
    }
    dashboard.hidden = false;
    await loadD006Page();
  } catch (error) {
    dashboard.hidden = false;
    const status = document.getElementById('d006Status');
    status.dataset.state = 'error';
    status.textContent = error.message;
  }
}

function renderD008Trend(id, yearlyResults, metric, valueMode) {
  const element = document.getElementById(id);
  if (!element || !window.echarts) return;
  const chart = window.echarts.getInstanceByDom(element) || window.echarts.init(element);
  d008Charts.set(id, chart);
  const panel = element.closest('.d006-chart-panel');
  const styles = getComputedStyle(panel || element);
  const textColor = styles.getPropertyValue('--text-primary').trim() || '#222222';
  const rows = yearlyResults.flatMap((result) => result[metric] || []);
  const categories = new Map();
  rows.forEach((item) => categories.set(String(item.code ?? item.label), item.label));
  const categoryEntries = [...categories.entries()];
  if (!categoryEntries.length) {
    chart.setOption({ graphic: [{ type: 'text', left: 'center', top: 'middle', style: { text: 'Нет данных для выбранных фильтров', fill: textColor, fontSize: 14 } }] }, true);
    return;
  }

  const valueKey = valueMode === 'share' ? 'share' : 'count';
  const suffix = valueMode === 'share' ? '%' : '';
  const series = categoryEntries.map(([code, label]) => ({
    name: label,
    type: 'bar',
    barMaxWidth: 42,
    emphasis: { focus: 'series', scale: 1.25 },
    data: yearlyResults.map((result) => {
      if (metric === 'age_structure' && !result.age_available) return null;
      const item = (result[metric] || []).find((entry) => String(entry.code ?? entry.label) === code);
      const value = Number(item?.[valueKey] || 0);
      return valueMode === 'share' ? Math.round(value * 10) / 10 : Math.round(value);
    })
  }));

  chart.setOption({
    animationDuration: 350,
    color: DATA_COLORS,
    tooltip: {
      trigger: 'axis',
      confine: true,
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const points = Array.isArray(params) ? params : [params];
        return `${points[0]?.axisValue || ''}<br>${points.map((point) => `${point.marker}${point.seriesName}: <strong>${Number(point.value).toLocaleString('ru-RU')}${suffix}</strong>`).join('<br>')}`;
      }
    },
    legend: { type: 'scroll', bottom: 0, left: 8, right: 8, height: 48, itemWidth: 12, itemHeight: 8, textStyle: { color: textColor, fontSize: 12 } },
    grid: { left: 58, right: 22, top: 16, bottom: 65, containLabel: true },
    xAxis: { type: 'category', boundaryGap: true, data: yearlyResults.map((result) => String(result.year)), axisLabel: { color: textColor, fontSize: 13 }, axisLine: { lineStyle: { color: 'rgba(139, 146, 152, .45)' } }, axisTick: { show: false } },
    yAxis: { type: 'value', min: 0, max: valueMode === 'share' ? 100 : undefined, scale: valueMode !== 'share', minInterval: valueMode === 'count' ? 1 : undefined, axisLabel: { color: textColor, fontSize: 12, formatter: (value) => `${Number(value).toLocaleString('ru-RU')}${suffix}` }, splitLine: { lineStyle: { color: 'rgba(139, 146, 152, .2)' } } },
    series
  }, true);
  chart.resize();
}

function disposeD008Charts() {
  d008Charts.forEach((chart) => chart.dispose());
  d008Charts.clear();
}

const D008_CHARTS = [
  ['settlement', 'd008SettlementChart', 'd008UnitSettlement'],
  ['gender', 'd008GenderChart', 'd008UnitGender'],
  ['relationships', 'd008RelationshipChart', 'd008UnitRelationship'],
  ['education', 'd008EducationChart', 'd008UnitEducation'],
  ['marital_status', 'd008MaritalChart', 'd008UnitMarital'],
  ['activity', 'd008ActivityChart', 'd008UnitActivity'],
  ['age_structure', 'd008AgeChart', 'd008UnitAge'],
  ['household_sizes', 'd008HouseholdSizeChart', 'd008UnitHouseholds']
];

const D008_FILTER_OPTIONS = [
  ['age_group', 'Возраст', [['', 'Все возрасты'], ['0-14', '0–14 лет'], ['15-24', '15–24 года'], ['25-39', '25–39 лет'], ['40-59', '40–59 лет'], ['60+', '60 лет и старше']]],
  ['gender', 'Пол', [['', 'Любой'], ['1', 'Мужчины'], ['2', 'Женщины']]],
  ['settlement', 'Город или село', [['', 'Все территории'], ['1', 'Город'], ['2', 'Село']]],
  ['relationship', 'Родство', [['', 'Любое'], ['1', 'Глава домохозяйства'], ['2', 'Супруг или супруга'], ['3', 'Сын или дочь'], ['4', 'Отец или мать'], ['5', 'Брат или сестра'], ['6', 'Дедушка или бабушка'], ['7', 'Внук или внучка'], ['8', 'Другая степень родства'], ['9', 'Не родственник']]],
  ['education', 'Образование', [['', 'Любой уровень'], ['1', 'Дошкольное'], ['2', 'Начальное'], ['3', 'Основное среднее'], ['4', 'Среднее или профессиональное'], ['5', 'Высшее'], ['6', 'Послевузовское'], ['7', 'Нет достигнутого уровня']]],
  ['marital_status', 'Семейное положение', [['', 'Любое'], ['1', 'Не состоял(а) в браке'], ['2', 'Состоит в браке'], ['3', 'Вдовец или вдова'], ['4', 'Разведён(а)']]],
  ['activity', 'Занятость', [['', 'Любой статус'], ['1', 'Работа по найму'], ['2', 'Предпринимательство'], ['3', 'Ищет работу'], ['4', 'Пенсионер'], ['5', 'Учащийся или студент'], ['6', 'Домашнее хозяйство или уход'], ['7', 'Нетрудоспособен'], ['8', 'Не работает по другим причинам']]],
  ['value_mode', 'Показатель', [['count', 'Абсолютное число'], ['share', 'Доля, %']]]
];

function initializeD008ChartFilters() {
  document.querySelectorAll('[data-d008-chart]').forEach((panel) => {
    if (panel.querySelector('.d008-chart-filter-details')) return;
    const details = document.createElement('details');
    details.className = 'd008-chart-filter-details';
    const summary = document.createElement('summary');
    summary.textContent = 'Фильтры графика';
    const controls = document.createElement('div');
    controls.className = 'd008-chart-filter-grid';
    D008_FILTER_OPTIONS.forEach(([name, label, options]) => {
      const field = document.createElement('label');
      field.textContent = label;
      const select = document.createElement('select');
      select.dataset.d008Filter = name;
      options.forEach(([value, text]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        select.append(option);
      });
      field.append(select);
      controls.append(field);
      select.addEventListener('change', () => refreshD008Chart(panel));
    });
    details.append(summary, controls);
    panel.insertBefore(details, panel.querySelector('.dataset-chart'));
  });
}

function d008PanelFilters(panel) {
  return Object.fromEntries([...panel.querySelectorAll('[data-d008-filter]')]
    .map((control) => [control.dataset.d008Filter, control.value]).filter(([, value]) => value));
}

async function fetchD008Year(year, filters = {}) {
  const params = new URLSearchParams({ year });
  Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
  const response = await fetch(`${activeApiUrl}/api/d008/data?${params}`);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Не удалось загрузить D008 за ${year}.`);
  return result;
}

async function refreshD008Chart(panel) {
  const metric = panel.dataset.d008Chart;
  const chartConfig = D008_CHARTS.find(([key]) => key === metric);
  if (!chartConfig) return;
  const [, chartId, unitId] = chartConfig;
  const filters = d008PanelFilters(panel);
  const valueMode = filters.value_mode || 'count';
  delete filters.value_mode;
  const currentId = String(Number(panel.dataset.requestId || 0) + 1);
  panel.dataset.requestId = currentId;
  try {
    const yearlyResults = Object.keys(filters).length
      ? await Promise.all(d008BaseResults.map(({ year }) => fetchD008Year(year, filters)))
      : d008BaseResults;
    if (panel.dataset.requestId !== currentId) return;
    const latest = yearlyResults.at(-1);
    renderD008Trend(chartId, yearlyResults, metric, valueMode);
    const answeredValue = latest?.answered?.[metric] ?? (metric === 'household_sizes' ? latest?.households : latest?.people);
    const answered = Number(answeredValue ?? 0);
    setText(unitId, valueMode === 'share' ? `доля от ${answered.toLocaleString('ru-RU')}, %` : `${metric === 'household_sizes' ? 'домохозяйств' : 'ответов'} · ${answered.toLocaleString('ru-RU')}`);
    if (metric === 'age_structure') {
      document.getElementById(chartId).hidden = !yearlyResults.some((result) => result.age_available);
      document.getElementById('d008AgeNoData').hidden = yearlyResults.some((result) => result.age_available);
    }
  } catch (error) {
    if (panel.dataset.requestId === currentId) {
      const chart = window.echarts?.getInstanceByDom(document.getElementById(chartId));
      chart?.setOption({ graphic: [{ type: 'text', left: 'center', top: 'middle', style: { text: error.message, fill: '#c84444', fontSize: 13 } }] }, true);
    }
  }
}

async function loadD008Page() {
  const status = document.getElementById('d008Status');
  const requestId = ++d008RequestId;
  const selectedYears = [...document.querySelectorAll('input[name="d008Year"]:checked')].map((input) => input.value).filter((year) => d008AvailableYears.includes(year));
  status.dataset.state = 'loading';
  status.textContent = 'Сравниваем демографические показатели по выбранным годам…';
  try {
    if (!selectedYears.length) throw new Error('Выберите хотя бы один год для сравнения.');
    const yearlyResults = await Promise.all(selectedYears.map((year) => fetchD008Year(year)));
    if (requestId !== d008RequestId) return;
    yearlyResults.sort((a, b) => Number(a.year) - Number(b.year));
    d008BaseResults = yearlyResults;
    disposeD008Charts();
    const latest = yearlyResults.at(-1);
    setText('d008PeopleLabel', `Людей в выборке · ${latest.year}`);
    setText('d008HouseholdsLabel', `Домохозяйств · ${latest.year}`);
    setText('d008HouseholdSizeLabel', `Средний размер семьи · ${latest.year}`);
    setText('d008AverageAgeLabel', `Средний возраст · ${latest.year}`);
    setText('d008PeopleStat', Number(latest.people).toLocaleString('ru-RU'));
    setText('d008HouseholdsStat', Number(latest.households).toLocaleString('ru-RU'));
    setText('d008HouseholdSizeStat', latest.average_household_size == null ? '—' : `${Number(latest.average_household_size).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} чел.`);
    setText('d008AverageAgeStat', latest.average_age == null ? '—' : `${Number(latest.average_age).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} года`);
    setText('d008ChildrenStat', latest.under_15_share == null ? '—' : `${Number(latest.under_15_share).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`);
    setText('d008TerritoriesStat', Number(latest.territories).toLocaleString('ru-RU'));
    D008_CHARTS.forEach(([metric]) => {
      const panel = document.querySelector(`[data-d008-chart="${metric}"]`);
      if (panel) void refreshD008Chart(panel);
    });
    const yearsLabel = yearlyResults.map((result) => result.year).join(', ');
    const sources = [...new Set(yearlyResults.map((result) => result.source === 'database.sqlite' ? 'database.sqlite' : 'CSV в data/sinte'))].join(', ');
    setText('d008SourceNote', `Сравниваются годы ${yearsLabel}; значения каждого года рассчитаны отдельно. Источник: ${sources}. Средний возраст и размер домохозяйства показаны для ${latest.year} года. В каждой карточке графика можно отдельно настроить фильтры.`);
    status.dataset.state = 'success';
    status.textContent = `${yearsLabel}: каждый год показан отдельно. В выборке ${latest.year} года — ${Number(latest.people).toLocaleString('ru-RU')} человек и ${Number(latest.households).toLocaleString('ru-RU')} домохозяйств.`;
  } catch (error) {
    if (requestId !== d008RequestId) return;
    disposeD008Charts();
    status.dataset.state = 'error';
    status.textContent = error.message;
  }
}

async function initializeD008(apiBaseUrl) {
  activeApiUrl = apiBaseUrl;
  const dashboard = document.getElementById('d008Dashboard');
  try {
    const response = await fetch(`${apiBaseUrl}/api/d008/options`);
    const options = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(options.error || 'Не удалось получить список данных D008.');
    if (!options.years.length) throw new Error('Данные D008 не найдены ни в data/sinte, ни в database.sqlite.');
    d008AvailableYears = ['2021', '2022', '2023', '2024'].filter((year) => options.years.includes(year));
    if (!d008AvailableYears.length) throw new Error('Для динамики нужны данные D008 за 2021–2024 годы.');
    const isFirstInitialization = !dashboard.dataset.listenersReady;
    document.querySelectorAll('input[name="d008Year"]').forEach((input) => {
      input.disabled = !d008AvailableYears.includes(input.value);
      if (isFirstInitialization || input.disabled) input.checked = d008AvailableYears.includes(input.value);
    });
    if (!dashboard.dataset.listenersReady) {
      initializeD008ChartFilters();
      document.querySelectorAll('input[name="d008Year"]').forEach((control) => control.addEventListener('change', loadD008Page));
      document.getElementById('d008ResetFilters').addEventListener('click', () => {
        document.querySelectorAll('input[name="d008Year"]').forEach((input) => { input.checked = d008AvailableYears.includes(input.value); });
        document.querySelectorAll('[data-d008-filter]').forEach((control) => { control.value = control.dataset.d008Filter === 'value_mode' ? 'count' : ''; });
        loadD008Page();
      });
      window.addEventListener('resize', () => d008Charts.forEach((chart) => chart.resize()));
      dashboard.dataset.listenersReady = 'true';
    }
    dashboard.hidden = false;
    await loadD008Page();
  } catch (error) {
    dashboard.hidden = false;
    const status = document.getElementById('d008Status');
    status.dataset.state = 'error';
    status.textContent = error.message;
  }
}

async function loadD002Page() {
  const status = document.getElementById('d002Status');
  const params = new URLSearchParams({
    year: document.getElementById('d002YearSelect').value,
    form: document.getElementById('d002FormSelect').value,
  });
  status.dataset.state = 'loading';
  status.textContent = 'Загружаем ответы обследования…';
  try {
    let result;
    if (params.get('year') === 'trend') {
      const years = [...document.getElementById('d002YearSelect').options].map((option) => option.value).filter((value) => value !== 'trend');
      const results = (await fetchDatasetYearData('/api/d002/data', years, { form: params.get('form') })).sort((a, b) => Number(a.year) - Number(b.year));
      const questionMap = new Map();
      results.forEach((yearResult) => yearResult.questions.forEach((question) => {
        const current = questionMap.get(question.id) || { ...question, yearly: [] };
        current.yearly.push({ ...question, year: yearResult.year });
        questionMap.set(question.id, current);
      }));
      const latest = results.at(-1);
      result = {
        ...latest,
        year: `Динамика ${results[0].year}–${latest.year}`,
        questions: [...questionMap.values()].map((question) => ({ ...question, ...question.yearly.at(-1), yearly: question.yearly })),
        question_count: questionMap.size
      };
    } else {
      const response = await fetch(`${activeApiUrl}/api/d002/data?${params}`);
      result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Не удалось загрузить D002.');
      result.questions = (result.questions || []).map((question) => ({ ...question, yearly: [{ ...question, year: result.year }] }));
    }

    setText('d002FormDescription', result.form_description);
    setText('d002ChartCaption', `${result.year} · ${result.form_label}. Найдено вопросов: ${Number(result.question_count).toLocaleString('ru-RU')}.`);
    setText('d002RespondentsLabel', `Анкет в ${result.year.includes('Динамика') ? result.year.split('–').at(-1) : result.year}`);
    setText('d002RespondentsStat', Number(result.respondents).toLocaleString('ru-RU'));
    setText('d002QuestionCountStat', Number(result.question_count).toLocaleString('ru-RU'));
    setText('d002TerritoriesStat', Number(result.territories).toLocaleString('ru-RU'));
    d002Questions = result.questions;
    d002Respondents = result.respondents;
    d002QuestionIndex = 0;
    document.getElementById('d002QuestionSearch').value = '';
    renderD002Question();
    status.dataset.state = 'success';
    status.textContent = `${result.year}: ${Number(result.respondents).toLocaleString('ru-RU')} анкет.`;
  } catch (error) {
    status.dataset.state = 'error';
    status.textContent = error.message;
    disposeD002Charts();
    document.getElementById('d002QuestionChart').hidden = true;
    document.getElementById('d002MapPanel').hidden = true;
  }
}

async function initializeD002(apiBaseUrl) {
  activeApiUrl = apiBaseUrl;
  const dashboard = document.getElementById('d002Dashboard');
  try {
    const response = await fetch(`${apiBaseUrl}/api/d002/options`);
    const options = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(options.error || 'Не удалось получить список данных D002.');
    if (!options.years.length || !options.forms.length) {
      throw new Error('Не найдены данные D002 в папке data/sinte или таблицы D002 в database.sqlite.');
    }

    const availableYears = [...options.years].sort((a, b) => Number(b) - Number(a));
    appendOptions(document.getElementById('d002YearSelect'), [...availableYears, 'trend'], String, (year) => year === 'trend' ? `Динамика по годам (${[...availableYears].reverse().join('–')})` : year);
    appendOptions(document.getElementById('d002FormSelect'), options.forms, (item) => item.id, (item) => item.label);
    if (!dashboard.dataset.listenersReady) {
      document.getElementById('d002YearSelect').value = preferredDatasetYear(availableYears);
      ['d002YearSelect', 'd002FormSelect'].forEach((id) => {
        document.getElementById(id).addEventListener('change', loadD002Page);
      });
      document.getElementById('d002QuestionSearch').addEventListener('input', () => {
        d002QuestionIndex = 0;
        renderD002Question();
      });
      document.getElementById('d002PreviousQuestion').addEventListener('click', () => {
        if (d002QuestionIndex > 0) { d002QuestionIndex -= 1; renderD002Question(); }
      });
      document.getElementById('d002NextQuestion').addEventListener('click', () => {
        if (d002QuestionIndex < d002FilteredQuestions.length - 1) { d002QuestionIndex += 1; renderD002Question(); }
      });
      document.getElementById('d002ValueMode').addEventListener('change', renderD002Question);
      dashboard.dataset.listenersReady = 'true';
    }
    dashboard.hidden = false;
    await loadD002Page();
  } catch (error) {
    dashboard.hidden = false;
    const status = document.getElementById('d002Status');
    status.dataset.state = 'error';
    status.textContent = error.message;
  }
}

function activeD004Query() {
  const params = new URLSearchParams({
    year: document.getElementById('d004YearSelect').value,
    quarter: document.getElementById('d004QuarterSelect').value,
    module: document.getElementById('d004ModuleSelect').value,
    page: String(currentPage),
    page_size: '50'
  });
  return params;
}

function renderD004Table(columns, rows) {
  const head = document.getElementById('d004TableHead');
  const body = document.getElementById('d004TableBody');
  const headerRow = document.createElement('tr');
  columns.forEach((column) => {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = column;
    headerRow.append(cell);
  });
  head.replaceChildren(headerRow);

  const fragment = document.createDocumentFragment();
  rows.forEach((row) => {
    const tableRow = document.createElement('tr');
    columns.forEach((column) => {
      const cell = document.createElement('td');
      cell.textContent = row[column] ?? '';
      tableRow.append(cell);
    });
    fragment.append(tableRow);
  });
  body.replaceChildren(fragment);
}

function renderD004Chart(chartData, metric, moduleLabel, year, quarter) {
  const chartElement = document.getElementById('d004TerritoryChart');
  if (!chartElement || !window.echarts) return;
  d004Chart = window.echarts.getInstanceByDom(chartElement) || window.echarts.init(chartElement);
  const dark = document.body.classList.contains('dark-theme');
  const textColor = dark ? '#eee5ed' : '#48534b';
  const colors = DATA_COLORS;
  d004Chart.setOption({
    color: colors,
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, textStyle: { color: '#222' } },
    grid: { left: 48, right: 24, top: 48, bottom: 68, containLabel: true },
    xAxis: {
      type: 'category',
      data: chartData.labels,
      axisLabel: { rotate: 35, interval: 0, color: textColor },
      axisLine: { lineStyle: { color: dark ? '#48534b' : '#d9ced6' } }
    },
    yAxis: { type: 'value', name: metric === 'Количество записей' ? 'Записей' : 'Значение', minInterval: 1, axisLabel: { color: textColor }, nameTextStyle: { color: textColor }, splitLine: { lineStyle: { color: dark ? 'rgba(255,255,255,.08)' : 'rgba(34,34,34,.08)' } } },
    series: [{
      name: metric,
      type: 'bar',
      data: chartData.values.map((value, index) => ({ value, itemStyle: { color: colors[index % colors.length] } })),
      barMaxWidth: 42,
      showBackground: true,
      backgroundStyle: { color: dark ? 'rgba(184,214,160,.12)' : 'rgba(184,214,160,.18)', borderRadius: [5, 5, 0, 0] },
      itemStyle: { borderRadius: [5, 5, 0, 0] }
    }],
    title: {
      text: `${moduleLabel} · ${year}, ${quarter.toUpperCase()}`,
      left: 'center',
    textStyle: { fontSize: 13, fontWeight: 600, color: textColor }
    }
  }, true);
  d004Chart.resize();
}

function renderD004Summary(summary) {
  const body = document.getElementById('d004SummaryBody');
  const fragment = document.createDocumentFragment();
  summary.forEach((item) => {
    const row = document.createElement('tr');
    [item.code, item.territory, Number(item.records).toLocaleString('ru-RU'), Number(item.households).toLocaleString('ru-RU'),
      item.amount == null ? '—' : Number(item.amount).toLocaleString('ru-RU')].forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    });
    fragment.append(row);
  });
  body.replaceChildren(fragment);
}

const d004RegionNames = {
  'Акмолинская область': 'Ақмола облысы', 'Актюбинская область': 'Ақтөбе облысы',
  'Алматинская область': 'Алматы облысы', 'Атырауская область': 'Атырау облысы',
  'Восточно-Казахстанская область': 'Шығыс Қазақстан облысы', 'Жамбылская область': 'Жамбыл облысы',
  'Западно-Казахстанская область': 'Батыс Қазақстан облысы', 'Карагандинская область': 'Қарағанды облысы',
  'Костанайская область': 'Қостанай облысы', 'Кызылординская область': 'Қызылорда облысы',
  'Мангистауская область': 'Маңғыстау облысы', 'Павлодарская область': 'Павлодар облысы',
  'Северо-Казахстанская область': 'Солтүстік Қазақстан облысы', 'Туркестанская область': 'Түркістан облысы',
  'Область Абай': 'Абай облысы', 'Область Жетысу': 'Жетісу облысы', 'Область Улытау': 'Ұлытау облысы',
  'г. Алматы': 'Алматы', 'г. Астана': 'Астана', 'г. Шымкент': 'Шымкент'
};

async function renderD004Map(summary, metric, period) {
  const element = document.getElementById('d004MapChart');
  if (!element || !window.echarts) return;
  d004Map = window.echarts.getInstanceByDom(element) || window.echarts.init(element);
  if (!d004MapResizeObserver && typeof ResizeObserver !== 'undefined') {
    d004MapResizeObserver = new ResizeObserver(() => d004Map?.resize());
    d004MapResizeObserver.observe(element);
  }
  try {
    if (!d004GeoJSON) {
      const response = await fetch('https://raw.githubusercontent.com/artemnovichkov/KazakhstanMapExample/main/KazakhstanMapExample/kazakhstan.geojson');
      if (!response.ok) throw new Error('Не удалось загрузить географические границы Казахстана.');
      d004GeoJSON = await response.json();
      window.echarts.registerMap('KZ_D004', d004GeoJSON);
    }
    d004MapSummary = summary;
    d004MapPeriod = period;
    const metricSelect = document.getElementById('d004MapMetric');
    const hasAmounts = summary.some((item) => item.amount != null);
    metricSelect.querySelector('option[value="amount"]').disabled = !hasAmounts;
    if (!hasAmounts && metricSelect.value === 'amount') metricSelect.value = 'records';
    d004MapMetricValue = metricSelect.value;
    const metricConfig = {
      records: { label: 'Количество записей', value: (item) => Number(item.records || 0) },
      households: { label: 'Количество домохозяйств', value: (item) => Number(item.households || 0) },
      amount: { label: 'Сумма стоимости', value: (item) => Number(item.amount || 0) }
    }[d004MapMetricValue];
    const data = summary.map((item) => ({
      name: d004RegionNames[item.territory] || item.territory,
      value: metricConfig.value(item),
      selected: (d004RegionNames[item.territory] || item.territory) === d004SelectedRegion
    }));
    const values = data.map((item) => item.value);
    const low = Math.min(...values, 0);
    const high = Math.max(...values, 1);
    d004Map.setOption({
      animation: false,
      tooltip: { trigger: 'item', formatter: (params) => `${params.name}<br>${metricConfig.label}: ${params.value == null ? 'Нет данных' : Number(params.value).toLocaleString('ru-RU')}` },
      visualMap: { min: low, max: high, left: 16, bottom: 12, orient: 'horizontal', calculable: true, inRange: { color: MAP_SCALE }, textStyle: { color: document.body.classList.contains('dark-theme') ? '#d4e4d4' : '#48534b' } },
      series: [{
        type: 'map', map: 'KZ_D004', roam: true, zoom: 1.1, layoutCenter: ['50%', '50%'], layoutSize: '108%', selectedMode: 'single', data,
        itemStyle: { areaColor: document.body.classList.contains('dark-theme') ? '#48534b' : '#8b9298', borderColor: document.body.classList.contains('dark-theme') ? '#b8d6a0' : '#fff', borderWidth: 1 },
        emphasis: { label: { show: true } },
        select: { itemStyle: { areaColor: '#a8cf45', borderColor: '#3e9b59', borderWidth: 2 }, label: { show: true, color: '#222222' } }
      }]
    }, true);
    setText('d004MapCaption', `${metricConfig.label} · ${period}. Красный — меньше, зелёный — больше, серый — нет данных. Колёсико приближает карту, перетаскивание перемещает её.`);
    if (!element.dataset.listenersReady) {
      d004Map.on('click', (params) => {
        d004SelectedRegion = params.name;
        showD004RegionDetails(params.name);
        d004Map.dispatchAction({ type: 'select', seriesIndex: 0, name: params.name });
      });
      element.dataset.listenersReady = 'true';
    }
    d004Map.resize();
  } catch (error) {
    setText('d004MapCaption', `${error.message} Карта требует подключения к интернету при первом открытии.`);
  }
}

const D004_FORM_DESCRIPTIONS = {
  0: 'Паспорт домохозяйства и сведения о его составе.',
  1: 'Покупки непродовольственных товаров и расходы на них.',
  2: 'Жильё, коммунальные услуги, вода, энергия и топливо.',
  3: 'Расходы на связь и телекоммуникационные услуги.',
  4: 'Расходы домохозяйства на образование.',
  5: 'Расходы домохозяйства на здравоохранение.',
  6: 'Расходы на отдых, культуру и прочие услуги.',
  7: 'Расходы домохозяйства на транспорт.',
  9: 'Производство и услуги, выполняемые домохозяйством (часть 1).',
  10: 'Производство и услуги, выполняемые домохозяйством (часть 2).',
  11: 'Источники и показатели доходов домохозяйства.',
  12: 'Заемные средства и кредитные обязательства домохозяйства.'
};

function loadD004QuestionnaireCard(card, revision) {
  const module = card.dataset.module;
  const params = new URLSearchParams({
    year: document.getElementById('d004YearSelect').value,
    quarter: document.getElementById('d004QuarterSelect').value,
    module,
    page: '1',
    page_size: '10'
  });
  const chartElement = card.querySelector('[data-d004-form-chart]');
  fetch(`${activeApiUrl}/api/d004/data?${params}`)
    .then(async (response) => {
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Не удалось загрузить этот раздел.');
      if (revision !== d004QuestionnaireRevision) return;
      const colors = DATA_COLORS;
      const regions = [...(result.territory_summary || [])].sort((a, b) => Number(b.records) - Number(a.records));
      const chart = window.echarts.getInstanceByDom(chartElement) || window.echarts.init(chartElement);
      chart.setOption({
        color: colors,
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (points) => `${points[0].name}<br>${Number(points[0].value).toLocaleString('ru-RU')}` },
        grid: { left: 42, right: 12, top: 12, bottom: 46, containLabel: true },
        xAxis: { type: 'category', data: regions.map((item) => item.territory), axisLabel: { rotate: 35, fontSize: 10, interval: 0 } },
        yAxis: { type: 'value', minInterval: 1 },
        series: [{ type: 'bar', barMaxWidth: 24, data: regions.map((item, index) => ({ value: Number(item.records), itemStyle: { color: colors[index % colors.length], borderRadius: [4, 4, 0, 0] } })) }]
      }, true);
      card.querySelector('[data-d004-form-status]').textContent = `${Number(result.total_rows).toLocaleString('ru-RU')} записей · количество по территориям`;
    })
    .catch((error) => {
      if (revision === d004QuestionnaireRevision) card.querySelector('[data-d004-form-status]').textContent = error.message;
    });
}

function renderD004QuestionnaireCards(modules) {
  const container = document.getElementById('d004QuestionnaireCards');
  if (!container) return;
  d004QuestionnaireRevision += 1;
  const revision = d004QuestionnaireRevision;
  d004QuestionnaireObserver?.disconnect();
  container.querySelectorAll('[data-d004-form-chart]').forEach((element) => window.echarts?.getInstanceByDom(element)?.dispose());
  container.replaceChildren();
  (modules || []).forEach((form) => {
    const article = document.createElement('article');
    article.className = 'd004-questionnaire-card';
    article.dataset.module = String(form.id);
    const heading = document.createElement('h3');
    heading.textContent = form.label;
    const description = document.createElement('p');
    description.textContent = D004_FORM_DESCRIPTIONS[form.id] || `Показатели раздела «${form.label}» обследования домохозяйств.`;
    const status = document.createElement('p');
    status.className = 'd004-questionnaire-status';
    status.dataset.d004FormStatus = '';
    status.textContent = 'График загрузится при прокрутке к карточке.';
    const chart = document.createElement('div');
    chart.className = 'd004-questionnaire-chart';
    chart.dataset.d004FormChart = '';
    chart.setAttribute('role', 'img');
    chart.setAttribute('aria-label', `Столбчатый график данных анкеты: ${form.label}`);
    article.append(heading, description, status, chart);
    container.append(article);
  });
  if (!('IntersectionObserver' in window)) {
    container.querySelectorAll('.d004-questionnaire-card').forEach((card) => loadD004QuestionnaireCard(card, revision));
    return;
  }
  d004QuestionnaireObserver = new IntersectionObserver((entries, observer) => {
    entries.filter((entry) => entry.isIntersecting).forEach((entry) => {
      observer.unobserve(entry.target);
      loadD004QuestionnaireCard(entry.target, revision);
    });
  }, { rootMargin: '80px 0px' });
  container.querySelectorAll('.d004-questionnaire-card').forEach((card) => d004QuestionnaireObserver.observe(card));
}

function showD004RegionDetails(regionName) {
  const record = d004MapSummary.find((item) => (d004RegionNames[item.territory] || item.territory) === regionName);
  setText('d004RegionTitle', regionName);
  const help = document.getElementById('d004RegionHelp');
  const stats = document.getElementById('d004RegionStats');
  if (!record) {
    help.textContent = `В выбранном периоде для этой территории нет строк с данными.`;
    stats.hidden = true;
    stats.replaceChildren();
    return;
  }
  help.textContent = `Данные раздела за ${d004MapPeriod}. Это записи синтетического набора, а не официальная статистика.`;
  const values = [
    ['Код территории', record.code],
    ['Записей в разделе', Number(record.records).toLocaleString('ru-RU')],
    ['Домохозяйств', Number(record.households).toLocaleString('ru-RU')]
  ];
  if (record.amount != null) values.push(['Сумма стоимости по записям', Number(record.amount).toLocaleString('ru-RU')]);
  stats.replaceChildren();
  values.forEach(([label, value]) => {
    const term = document.createElement('dt');
    const detail = document.createElement('dd');
    term.textContent = label;
    detail.textContent = value;
    stats.append(term, detail);
  });
  stats.hidden = false;
}

function updateD004MapMetric() {
  if (!d004MapSummary.length) return;
  renderD004Map(d004MapSummary, '', d004MapPeriod);
}

async function loadD004Page() {
  const status = document.getElementById('d004Status');
  const params = activeD004Query();
  d004SelectedRegion = '';
  setText('d004RegionTitle', 'Выберите область на карте');
  setText('d004RegionHelp', 'Нажмите на область или город, чтобы посмотреть данные. Цвет показывает выбранный выше показатель.');
  document.getElementById('d004RegionStats').hidden = true;
  status.dataset.state = 'loading';
  status.textContent = 'Считаем данные выбранного периода…';

  try {
    const response = await fetch(`${activeApiUrl}/api/d004/data?${params}`);
    const result = await response.json().catch(() => ({}));
    if (response.status === 404 && !result.error) {
      throw new Error('Запущена старая версия локального сервера. Полностью закройте и снова откройте приложение, чтобы загрузить API D004.');
    }
    if (!response.ok) throw new Error(result.error || 'Не удалось загрузить D004.');

    totalRows = result.total_rows;
    setText('d004RowsStat', Number(result.total_rows).toLocaleString('ru-RU'));
    setText('d004HouseholdsStat', Number(result.households).toLocaleString('ru-RU'));
    setText('d004TerritoriesStat', Number(result.territories).toLocaleString('ru-RU'));
    setText('d004TableCaption', `${result.module_label} · ${result.year}, ${result.quarter.toUpperCase()}`);
    setText('d004ChartCaption', result.chart_metric === 'Количество записей'
      ? 'Число строк по коду территории TE.'
      : 'Сумма поля STOIMK по строкам выбранного файла; это сумма записей выборки, а не оценка для всего населения.');
    setText('d004DescriptionMetric', result.chart_metric === 'Количество записей'
      ? 'Каждая колонка показывает количество строк для территории в выбранном году, квартале и разделе анкеты.'
      : 'Показана сумма STOIMK внутри выбранного года, квартала и раздела. Это сумма записей выборки, а не средний расход семьи и не официальная оценка.');
    setText('d004PageLabel', `Страница ${result.page} из ${Math.max(1, Math.ceil(totalRows / result.page_size))}`);
    document.getElementById('d004PrevPage').disabled = result.page <= 1;
    document.getElementById('d004NextPage').disabled = result.page * result.page_size >= totalRows;
    renderD004Table(result.columns, result.rows);
    renderD004Chart(result.chart, result.chart_metric, result.module_label, result.year, result.quarter);
    renderD004Summary(result.territory_summary || []);
    void renderD004Map(result.territory_summary || [], result.chart_metric, `${result.year}, ${result.quarter.toUpperCase()}`);
    status.dataset.state = 'success';
    const sourceNote = result.source === 'database.sqlite'
      ? ' Используем таблицы из database.sqlite.'
      : ' Источник: CSV в data/sinte.';
    status.textContent = `${Number(totalRows).toLocaleString('ru-RU')} строк в выбранном периоде.${sourceNote}`;
  } catch (error) {
    status.dataset.state = 'error';
    status.textContent = error.message;
    document.getElementById('d004TableHead').replaceChildren();
    document.getElementById('d004TableBody').replaceChildren();
  }
}

async function initializeD004(apiBaseUrl) {
  activeApiUrl = apiBaseUrl;
  currentPage = 1;
  const dashboard = document.getElementById('d004Dashboard');
  const placeholder = document.getElementById('datasetPlaceholder');
  dashboard.hidden = true;
  placeholder.hidden = true;

  try {
    const response = await fetch(`${apiBaseUrl}/api/d004/options`);
    const options = await response.json().catch(() => ({}));
    if (response.status === 404 && !options.error) {
      throw new Error('Запущена старая версия локального сервера. Полностью закройте и снова откройте приложение, чтобы загрузить API D004.');
    }
    if (!response.ok) throw new Error(options.error || 'Не удалось получить список файлов D004.');
    if (!options.years.length) throw new Error('Не найдены данные D004: проверьте CSV в data/sinte/d004 или убедитесь, что таблицы D004 импортированы в database.sqlite.');

    appendOptions(document.getElementById('d004YearSelect'), options.years, String, String);
    appendOptions(document.getElementById('d004QuarterSelect'), ['all', ...options.quarters], String, (value) => value === 'all' ? 'Все кварталы' : value.toUpperCase());
    appendOptions(document.getElementById('d004ModuleSelect'), options.modules, (item) => item.id, (item) => `${item.label} (vopr${item.id})`);
    renderD004QuestionnaireCards(options.modules);
    document.getElementById('d004QuarterSelect').value = '4kv';
    document.getElementById('d004ModuleSelect').value = '1';

    if (!dashboard.dataset.listenersReady) {
      document.getElementById('d004YearSelect').value = preferredDatasetYear(options.years);
      ['d004YearSelect', 'd004QuarterSelect', 'd004ModuleSelect'].forEach((id) => {
        document.getElementById(id).addEventListener('change', () => {
          currentPage = 1;
          renderD004QuestionnaireCards(options.modules);
          loadD004Page();
        });
      });
      document.getElementById('d004PrevPage').addEventListener('click', () => {
        if (currentPage > 1) {
          currentPage -= 1;
          loadD004Page();
        }
      });
      document.getElementById('d004NextPage').addEventListener('click', () => {
        if (currentPage * 50 < totalRows) {
          currentPage += 1;
          loadD004Page();
        }
      });
      document.getElementById('d004MapMetric').addEventListener('change', updateD004MapMetric);
      document.getElementById('d004MapReset').addEventListener('click', () => {
        d004SelectedRegion = '';
        setText('d004RegionTitle', 'Выберите область на карте');
        setText('d004RegionHelp', 'Нажмите на область или город, чтобы посмотреть данные. Цвет показывает выбранный выше показатель.');
        document.getElementById('d004RegionStats').hidden = true;
        updateD004MapMetric();
      });
      dashboard.dataset.listenersReady = 'true';
    }

    dashboard.hidden = false;
    await loadD004Page();
  } catch (error) {
    dashboard.hidden = false;
    document.getElementById('d004Status').dataset.state = 'error';
    setText('d004Status', error.message);
  }
}

export async function openSidebarDatasetPage(datasetId, element, apiBaseUrl) {
  const page = PAGE_CONFIG[datasetId] || {
    title: 'Раздел данных',
    breadcrumb: 'Данные',
    description: 'Раздел не найден.'
  };

  document.querySelectorAll('.cat-subitem').forEach((item) => item.classList.remove('active'));
  if (element) element.classList.add('active');
  document.querySelectorAll('.sidebar-home-link').forEach((item) => {
    item.classList.remove('active');
    item.removeAttribute('aria-current');
  });
  document.querySelectorAll('.cat-header').forEach((item) => item.classList.remove('active'));
  document.querySelectorAll('.program-switcher-button').forEach((button) => {
    const active = button.dataset.program === 'dashboard';
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });

  document.getElementById('mainDashboardContent').style.display = 'none';
  document.getElementById('householdSection').style.display = 'none';
  document.getElementById('dataAnalyzerSection').style.display = 'none';
  document.getElementById('detailedViewSection').style.display = 'none';
  document.getElementById('populationHypothesesSection').style.display = 'none';
  document.getElementById('aboutProjectSection').style.display = 'none';
  document.querySelector('.app-layout')?.classList.remove('home-route-active');
  const section = document.getElementById('datasetViewSection');
  section.style.display = 'block';
  setText('datasetPageTitle', page.title);
  setText('datasetPageBreadcrumb', page.breadcrumb);
  setText('datasetPageDescription', page.description);

  const d002 = datasetId === 'd002';
  const d004 = datasetId === 'd004';
  const d006 = datasetId === 'd006';
  const d008 = datasetId === 'd008';
  document.getElementById('d002Dashboard').hidden = !d002;
  document.getElementById('d004Dashboard').hidden = !d004;
  document.getElementById('d006Dashboard').hidden = !d006;
  document.getElementById('d008Dashboard').hidden = !d008;
  document.getElementById('datasetPlaceholder').hidden = d002 || d004 || d006 || d008;
  if (d002) {
    await initializeD002(apiBaseUrl);
  } else if (d004) {
    await initializeD004(apiBaseUrl);
  } else if (d006) {
    await initializeD006(apiBaseUrl);
  } else if (d008) {
    await initializeD008(apiBaseUrl);
  } else {
    const placeholder = document.getElementById('datasetPlaceholder');
    placeholder.replaceChildren();
    const message = document.createElement('p');
    message.textContent = 'Данные для этого раздела пока не подключены.';
    placeholder.append(message);
  }
}
