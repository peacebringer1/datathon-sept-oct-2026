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

const DATA_COLORS = ['#17b981', '#50b9d2', '#46cbb0', '#7fdef5', '#7ef5ad', '#13966d'];
const MAP_SCALE = ['#7fdef5', '#50b9d2', '#46cbb0', '#17b981', '#13966d'];

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

function mergeCounts(itemsByYear, key = 'code') {
  const merged = new Map();
  itemsByYear.flat().forEach((item) => {
    const id = item[key] ?? item.label;
    const current = merged.get(id) || { ...item, count: 0 };
    current.count += Number(item.count || 0);
    merged.set(id, current);
  });
  const items = [...merged.values()];
  const total = items.reduce((sum, item) => sum + item.count, 0);
  return items.map((item) => ({ ...item, share: total ? Math.round(item.count / total * 1000) / 10 : 0 }));
}

function combineD006(results) {
  const total = results.reduce((sum, item) => sum + Number(item.respondents || 0), 0);
  const weighted = (field) => {
    const valid = results.filter((item) => item[field] != null);
    const denominator = valid.reduce((sum, item) => sum + Number(item.respondents || 0), 0);
    return denominator ? Math.round(valid.reduce((sum, item) => sum + Number(item[field]) * Number(item.respondents || 0), 0) / denominator * 10) / 10 : null;
  };
  return {
    ...results[0], year: 'Все годы', respondents: total,
    territories: Math.max(...results.map((item) => Number(item.territories || 0))),
    average_total_area: weighted('average_total_area'), average_living_area: weighted('average_living_area'), average_rooms: weighted('average_rooms'),
    home_types: mergeCounts(results.map((item) => item.home_types)), ownership: mergeCounts(results.map((item) => item.ownership)),
    city_rural: mergeCounts(results.map((item) => item.city_rural)), land_access: mergeCounts(results.map((item) => item.land_access)),
    amenities: results[0].amenities.map((item) => {
      const count = results.reduce((sum, result) => sum + Number(result.amenities.find((entry) => entry.code === item.code)?.count || 0), 0);
      const answered = results.reduce((sum, result) => {
        const yearly = result.amenities.find((entry) => entry.code === item.code);
        return sum + (yearly?.share > 0 ? yearly.count / (yearly.share / 100) : Number(result.respondents || 0));
      }, 0);
      return { ...item, count, share: answered ? Math.round(count / answered * 1000) / 10 : 0 };
    }),
    durable_goods: mergeCounts(results.map((item) => item.durable_goods), 'code').sort((a, b) => b.count - a.count).slice(0, 15)
  };
}

function combineD008(results) {
  const people = results.reduce((sum, item) => sum + Number(item.people || 0), 0);
  const households = results.reduce((sum, item) => sum + Number(item.households || 0), 0);
  const weighted = (field, weightField = 'people') => {
    const valid = results.filter((item) => item[field] != null);
    const denominator = valid.reduce((sum, item) => sum + Number(item[weightField] || 0), 0);
    return denominator ? Math.round(valid.reduce((sum, item) => sum + Number(item[field]) * Number(item[weightField] || 0), 0) / denominator * 10) / 10 : null;
  };
  return {
    ...results[0], year: 'Все годы', people, households,
    territories: Math.max(...results.map((item) => Number(item.territories || 0))),
    average_household_size: weighted('average_household_size', 'households'), average_age: weighted('average_age'),
    under_15_share: weighted('under_15_share'), age_available: results.some((item) => item.age_available),
    settlement: mergeCounts(results.map((item) => item.settlement)), gender: mergeCounts(results.map((item) => item.gender)),
    relationships: mergeCounts(results.map((item) => item.relationships)), education: mergeCounts(results.map((item) => item.education)),
    marital_status: mergeCounts(results.map((item) => item.marital_status)), activity: mergeCounts(results.map((item) => item.activity)),
    age_structure: mergeCounts(results.map((item) => item.age_structure), 'label'),
    household_sizes: mergeCounts(results.map((item) => item.household_sizes), 'label')
  };
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
let d004Map = null;
let d004MapResizeObserver = null;
let d004GeoJSON = null;
let d004MapSummary = [];
let d004MapPeriod = '';
let d004MapMetricValue = 'records';
let d004SelectedRegion = '';

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

function bindDatasetYearTabs(dataset, yearSelect, latestYear, quarterSelect = null) {
  const buttons = [...document.querySelectorAll(`[data-dataset="${dataset}"][data-year-mode]`)];
  const yearLabel = yearSelect.closest('label');
  const activate = (mode, load = true) => {
    buttons.forEach((button) => {
      const selected = button.dataset.yearMode === mode;
      button.setAttribute('aria-selected', String(selected));
      button.classList.toggle('active', selected);
    });
    if (yearLabel) yearLabel.hidden = mode === 'all';
    yearSelect.value = mode === 'all' ? 'all' : latestYear;
    if (quarterSelect) quarterSelect.value = mode === 'all' ? 'all' : '4kv';
    if (load) yearSelect.dispatchEvent(new Event('change', { bubbles: true }));
  };
  buttons.forEach((button) => button.addEventListener('click', () => activate(button.dataset.yearMode)));
  activate(yearSelect.value === 'all' ? 'all' : 'single', false);
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
  const surfaceColor = styles.backgroundColor || '#ffffff';
  chart.setOption({
    color: DATA_COLORS,
    tooltip: {
      trigger: 'item',
      formatter: ({ name, value, percent }) => `${name}<br>${Number(value).toLocaleString('ru-RU')} ответов · ${percent}%`
    },
    legend: {
      top: '5%', left: 'center', type: 'scroll', width: '88%',
      textStyle: { color: textColor, fontSize: 13 }
    },
    series: [{
      name: 'Ответы', type: 'pie', radius: ['40%', '70%'], center: ['50%', '58%'],
      avoidLabelOverlap: false, padAngle: 5,
      data: question.distribution.map((item) => ({ value: item.count, name: item.label })),
      label: { show: false, position: 'center' },
      emphasis: {
        scaleSize: 8,
        label: {
          show: true, color: textColor, fontSize: 19, fontWeight: 'bold',
          formatter: ({ name, percent }) => `${name}\n${percent}%`
        }
      },
      labelLine: { show: false },
      itemStyle: { borderRadius: 10, borderColor: surfaceColor, borderWidth: 3 }
    }]
  });
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
  setText('d002ChartCaption', `Ответы ${Number(question.answered).toLocaleString('ru-RU')} участников. Наведите на сектор, чтобы увидеть число и долю.`);
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
    if (selectedYear === 'all') {
      const years = [...document.getElementById('d002YearSelect').options].map((option) => option.value).filter((year) => year !== 'all');
      const yearlyMaps = await Promise.all(years.map(async (year) => {
        const yearParams = new URLSearchParams({ year, form: document.getElementById('d002FormSelect').value, question: question.id });
        const mapResponse = await fetch(`${activeApiUrl}/api/d002/map?${yearParams}`);
        return mapResponse.ok ? mapResponse.json() : null;
      }));
      const available = yearlyMaps.filter(Boolean);
      result = available[0];
      if (result) {
        result.categories = [...new Map(available.flatMap((entry) => entry.categories || []).map((item) => [item.code, item])).values()];
        const regionMap = new Map();
        available.flatMap((entry) => entry.regions || []).forEach((region) => {
          const current = regionMap.get(region.code) || { ...region, answered: 0, distribution: region.distribution.map((item) => ({ ...item, count: 0 })) };
          current.answered += Number(region.answered || 0);
          region.distribution.forEach((item) => {
            const match = current.distribution.find((value) => value.code === item.code);
            if (match) match.count += Number(item.count || 0);
            else current.distribution.push({ ...item });
          });
          regionMap.set(region.code, current);
        });
        result.regions = [...regionMap.values()].map((region) => ({ ...region, distribution: region.distribution.map((item) => ({ ...item, share: region.answered ? Math.round(item.count / region.answered * 1000) / 10 : 0 })) }));
      }
    } else {
      response = await fetch(`${activeApiUrl}/api/d002/map?${params}`);
      result = await response.json().catch(() => ({}));
    }
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
    setText('d002MapCaption', `${question.label} · сравнение распределения ответов по областям. Размер круга условный; секторы показывают доли ответов.`);
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
  const element = document.getElementById(id);
  if (!element || !window.echarts || !items.length) return;
  const chart = window.echarts.init(element);
  d006Charts.set(id, chart);
  const styles = getComputedStyle(element.closest('.d006-chart-panel'));
  const textColor = styles.getPropertyValue('--text-primary').trim() || '#222222';
  chart.setOption({
    color: DATA_COLORS,
    tooltip: { trigger: 'item', formatter: ({ name, value, percent }) => `${name}<br>${Number(value).toLocaleString('ru-RU')} домохозяйств · ${percent}%` },
    legend: { top: '3%', left: 'center', type: 'scroll', textStyle: { color: textColor, fontSize: 13 } },
    series: [{
      name: 'Домохозяйства', type: 'pie', radius: ['40%', '70%'], center: ['50%', '59%'],
      avoidLabelOverlap: false, padAngle: 4,
      data: items.map((item) => ({ value: item.count, name: item.label })),
      label: { show: false, position: 'center' },
      emphasis: { label: { show: true, color: textColor, fontSize: 16, fontWeight: 'bold', formatter: ({ name, percent }) => `${name}\n${percent}%` } },
      labelLine: { show: false },
      itemStyle: { borderRadius: 9, borderColor: styles.backgroundColor, borderWidth: 3 }
    }]
  });
  chart.resize();
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
    if (year === 'all') {
      const years = [...document.getElementById('d006YearSelect').options].map((option) => option.value).filter((value) => value !== 'all');
      result = combineD006(await fetchDatasetYearData('/api/d006/data', years));
    } else {
      const response = await fetch(`${activeApiUrl}/api/d006/data?year=${encodeURIComponent(year)}`);
      result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Не удалось загрузить D006.');
    }
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
    setText('d006SourceNote', year === 'all' ? `Итоги за ${[...document.getElementById('d006YearSelect').options].map((option) => option.value).filter((value) => value !== 'all').join(', ')} годы. Категории суммированы, средние значения взвешены по числу анкет.` : `Год ${result.year}. Источник: ${result.source === 'database.sqlite' ? 'database.sqlite' : 'CSV в data/sinte'}. Средние значения рассчитаны по анкетам с заполненным ответом.`);
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
    appendOptions(document.getElementById('d006YearSelect'), ['all', ...options.years], String, (year) => year === 'all' ? 'Все годы' : year);
    if (!dashboard.dataset.listenersReady) {
      bindDatasetYearTabs('d006', document.getElementById('d006YearSelect'), preferredDatasetYear(options.years));
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

function renderD008Pie(id, items) {
  const element = document.getElementById(id);
  if (!element || !window.echarts || !items.length) return;
  const chart = window.echarts.init(element);
  d008Charts.set(id, chart);
  const styles = getComputedStyle(element.closest('.d006-chart-panel'));
  const textColor = styles.getPropertyValue('--text-primary').trim() || '#222222';
  chart.setOption({
    color: DATA_COLORS,
    tooltip: { trigger: 'item', formatter: ({ name, value, percent }) => `${name}<br>${Number(value).toLocaleString('ru-RU')} человек · ${percent}%` },
    legend: { top: '3%', left: 'center', type: 'scroll', textStyle: { color: textColor, fontSize: 13 } },
    series: [{
      name: 'Участники обследования', type: 'pie', radius: ['40%', '70%'], center: ['50%', '59%'],
      avoidLabelOverlap: false, padAngle: 4,
      data: items.map((item) => ({ value: item.count, name: item.label })),
      label: { show: false, position: 'center' },
      emphasis: { label: { show: true, color: textColor, fontSize: 15, fontWeight: 'bold', formatter: ({ name, percent }) => `${name}\n${percent}%` } },
      labelLine: { show: false },
      itemStyle: { borderRadius: 9, borderColor: styles.backgroundColor, borderWidth: 3 }
    }]
  });
  chart.resize();
}

function renderD008Bars(id, items, valueKey, suffix = '', sortByValue = true) {
  const element = document.getElementById(id);
  if (!element || !window.echarts || !items.length) return;
  const chart = window.echarts.init(element);
  d008Charts.set(id, chart);
  const styles = getComputedStyle(element.closest('.d006-chart-panel'));
  const textColor = styles.getPropertyValue('--text-primary').trim() || '#222222';
  const sorted = sortByValue ? [...items].sort((a, b) => Number(a[valueKey]) - Number(b[valueKey])) : items;
  chart.setOption({
    color: DATA_COLORS,
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params) => `${params[0].name}<br>${Number(params[0].value).toLocaleString('ru-RU')}${suffix}` },
    grid: { left: 12, right: 45, top: 10, bottom: 10, containLabel: true },
    xAxis: { type: 'value', max: suffix === '%' ? 100 : undefined, axisLabel: { color: textColor, formatter: suffix === '%' ? '{value}%' : '{value}' }, splitLine: { lineStyle: { color: 'rgba(139, 146, 152, 0.25)' } } },
    yAxis: { type: 'category', data: sorted.map((item) => item.label), axisLabel: { color: textColor, width: 245, overflow: 'truncate' }, axisLine: { show: false } },
    series: [{ type: 'bar', data: sorted.map((item, index) => ({ value: item[valueKey], itemStyle: { color: DATA_COLORS[index % DATA_COLORS.length] } })), barMaxWidth: 25, itemStyle: { borderRadius: [0, 7, 7, 0] }, label: { show: true, position: 'right', color: textColor, fontSize: 13, formatter: ({ value }) => `${Number(value).toLocaleString('ru-RU')}${suffix}` } }]
  });
  chart.resize();
}

function disposeD008Charts() {
  d008Charts.forEach((chart) => chart.dispose());
  d008Charts.clear();
}

async function loadD008Page() {
  const status = document.getElementById('d008Status');
  const year = document.getElementById('d008YearSelect').value;
  status.dataset.state = 'loading';
  status.textContent = 'Загружаем состав домохозяйств…';
  try {
    let result;
    if (year === 'all') {
      const years = [...document.getElementById('d008YearSelect').options].map((option) => option.value).filter((value) => value !== 'all');
      result = combineD008(await fetchDatasetYearData('/api/d008/data', years));
    } else {
      const response = await fetch(`${activeApiUrl}/api/d008/data?year=${encodeURIComponent(year)}`);
      result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Не удалось загрузить D008.');
    }
    disposeD008Charts();
    setText('d008PeopleStat', Number(result.people).toLocaleString('ru-RU'));
    setText('d008HouseholdsStat', Number(result.households).toLocaleString('ru-RU'));
    setText('d008HouseholdSizeStat', result.average_household_size == null ? '—' : `${Number(result.average_household_size).toLocaleString('ru-RU')} чел.`);
    setText('d008AverageAgeStat', result.average_age == null ? '—' : `${Number(result.average_age).toLocaleString('ru-RU')} года`);
    setText('d008ChildrenStat', result.under_15_share == null ? '—' : `${Number(result.under_15_share).toLocaleString('ru-RU')}%`);
    setText('d008TerritoriesStat', Number(result.territories).toLocaleString('ru-RU'));
    document.getElementById('d008AgeNoData').hidden = result.age_available;
    document.getElementById('d008AgeChart').hidden = !result.age_available;
    renderD008Pie('d008SettlementChart', result.settlement);
    renderD008Pie('d008GenderChart', result.gender);
    renderD008Pie('d008RelationshipChart', result.relationships);
    renderD008Pie('d008EducationChart', result.education);
    renderD008Pie('d008MaritalChart', result.marital_status);
    renderD008Bars('d008ActivityChart', result.activity, 'share', '%');
    renderD008Bars('d008AgeChart', result.age_structure, 'share', '%', false);
    renderD008Bars('d008HouseholdSizeChart', result.household_sizes, 'count', '', false);
    setText('d008SourceNote', year === 'all' ? 'Итоги за все доступные годы. Категории объединены по количеству записей, средние значения взвешены.' : `Год ${result.year}. Источник: ${result.source === 'database.sqlite' ? 'database.sqlite' : 'CSV в data/sinte'}. Средний возраст рассчитывается на 1 января отчётного года; анкета за ${result.year} год содержит ${Number(result.people).toLocaleString('ru-RU')} записей о людях.`);
    status.dataset.state = 'success';
    status.textContent = `${result.year}: ${Number(result.people).toLocaleString('ru-RU')} человек из ${Number(result.households).toLocaleString('ru-RU')} обследованных домохозяйств.`;
  } catch (error) {
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
    appendOptions(document.getElementById('d008YearSelect'), ['all', ...options.years], String, (year) => year === 'all' ? 'Все годы' : year);
    if (!dashboard.dataset.listenersReady) {
      bindDatasetYearTabs('d008', document.getElementById('d008YearSelect'), preferredDatasetYear(options.years));
      document.getElementById('d008YearSelect').addEventListener('change', loadD008Page);
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
    if (params.get('year') === 'all') {
      const years = [...document.getElementById('d002YearSelect').options].map((option) => option.value).filter((value) => value !== 'all');
      const results = await fetchDatasetYearData('/api/d002/data', years, { form: params.get('form') });
      const questionMap = new Map();
      results.forEach((yearResult) => yearResult.questions.forEach((question) => {
        const current = questionMap.get(question.id) || { ...question, answered: 0, missing: 0, distribution: [] };
        current.answered += Number(question.answered || 0);
        current.missing += Number(question.missing || 0);
        current.distribution.push(...question.distribution);
        questionMap.set(question.id, current);
      }));
      result = { ...results[0], year: 'Все годы', respondents: results.reduce((sum, item) => sum + Number(item.respondents || 0), 0), territories: Math.max(...results.map((item) => Number(item.territories || 0))), questions: [...questionMap.values()].map((question) => ({ ...question, distribution: mergeCounts([question.distribution]) })), question_count: questionMap.size };
    } else {
      const response = await fetch(`${activeApiUrl}/api/d002/data?${params}`);
      result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Не удалось загрузить D002.');
    }

    setText('d002FormDescription', result.form_description);
    setText('d002ChartCaption', `${result.year} · ${result.form_label}. Найдено вопросов: ${Number(result.question_count).toLocaleString('ru-RU')}.`);
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

    appendOptions(document.getElementById('d002YearSelect'), ['all', ...options.years], String, (year) => year === 'all' ? 'Все годы' : year);
    appendOptions(document.getElementById('d002FormSelect'), options.forms, (item) => item.id, (item) => item.label);
    if (!dashboard.dataset.listenersReady) {
      bindDatasetYearTabs('d002', document.getElementById('d002YearSelect'), preferredDatasetYear(options.years));
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
        select: { itemStyle: { areaColor: '#7ef5ad', borderColor: '#17b981', borderWidth: 2 }, label: { show: true, color: '#222222' } }
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
      ? 'На графике каждая колонка показывает, сколько строк найдено для кода территории TE в выбранном разделе и периоде. При выборе всех лет или кварталов строки суммируются по всему выбранному диапазону.'
      : 'На графике показана сумма стоимости (поле STOIMK) по строкам для каждой территории. Это сумма записей выборки, а не средний расход семьи и не официальная оценка. При выборе всех лет или кварталов суммируются все подходящие файлы.');
    setText('d004PageLabel', `Страница ${result.page} из ${Math.max(1, Math.ceil(totalRows / result.page_size))}`);
    document.getElementById('d004PrevPage').disabled = result.page <= 1;
    document.getElementById('d004NextPage').disabled = result.page * result.page_size >= totalRows;
    renderD004Table(result.columns, result.rows);
    renderD004Chart(result.chart, result.chart_metric, result.module_label, result.year, result.quarter);
    renderD004Summary(result.territory_summary || []);
    await renderD004Map(result.territory_summary || [], result.chart_metric, `${result.year}, ${result.quarter.toUpperCase()}`);
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

    appendOptions(document.getElementById('d004YearSelect'), ['all', ...options.years], String, (value) => value === 'all' ? 'Все годы' : value);
    appendOptions(document.getElementById('d004QuarterSelect'), ['all', ...options.quarters], String, (value) => value === 'all' ? 'Все кварталы' : value.toUpperCase());
    appendOptions(document.getElementById('d004ModuleSelect'), options.modules, (item) => item.id, (item) => `${item.label} (vopr${item.id})`);
    document.getElementById('d004QuarterSelect').value = 'all';
    document.getElementById('d004ModuleSelect').value = '1';

    if (!dashboard.dataset.listenersReady) {
      bindDatasetYearTabs('d004', document.getElementById('d004YearSelect'), preferredDatasetYear(options.years), document.getElementById('d004QuarterSelect'));
      ['d004YearSelect', 'd004QuarterSelect', 'd004ModuleSelect'].forEach((id) => {
        document.getElementById(id).addEventListener('change', () => {
          currentPage = 1;
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
