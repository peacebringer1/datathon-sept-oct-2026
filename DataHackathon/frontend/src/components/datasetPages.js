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

let DATA_COLORS = ['#17b981', '#50b9d2', '#46cbb0', '#7fdef5', '#7ef5ad', '#13966d'];
let MAP_SCALE = ['#7fdef5', '#50b9d2', '#46cbb0', '#17b981', '#13966d'];
let D002_SATISFACTION_COLORS = {
  'Высокая удовлетворённость': '#7ef5ad',
  'Частичная удовлетворённость': '#50b9d2',
  'Низкая удовлетворённость': '#a78bfa',
  'Не применимо / затруднились ответить': '#687780'
};
let D002_CATEGORY_COLORS = ['#50b9d2', '#a78bfa', '#46cbb0', '#7c9cff', '#7ef5ad', '#6ee7f9', '#b8a6ff'];

function d002AnswerColor(label, index, satisfactionScale = false) {
  if (satisfactionScale && D002_SATISFACTION_COLORS[label]) return D002_SATISFACTION_COLORS[label];
  const stableIndex = [...String(label)].reduce((hash, character) => (hash * 31 + character.codePointAt(0)) >>> 0, 7);
  return D002_CATEGORY_COLORS[stableIndex % D002_CATEGORY_COLORS.length];
}
window.addEventListener('app-style-preset-changed', (event) => {
  const palettes = {
    classic: ['#cf7f5f', '#a78bb5', '#c58eaa', '#e1a07f', '#9b82a6', '#765f80'],
    green: ['#17b981', '#50b9d2', '#46cbb0', '#7fdef5', '#7ef5ad', '#13966d']
  };
  const mapPalettes = {
    classic: ['#f2c09c', '#e5a5a1', '#c99fba', '#a78bb5', '#806b88'],
    green: ['#7fdef5', '#50b9d2', '#46cbb0', '#17b981', '#13966d']
  };
  DATA_COLORS = palettes[event.detail?.preset] || palettes.green;
  MAP_SCALE = mapPalettes[event.detail?.preset] || mapPalettes.green;
  D002_CATEGORY_COLORS = event.detail?.preset === 'classic'
    ? ['#cf7f5f', '#a78bb5', '#c58eaa', '#e1a07f', '#9b82a6', '#d99a8d', '#765f80']
    : ['#50b9d2', '#a78bfa', '#46cbb0', '#7c9cff', '#7ef5ad', '#6ee7f9', '#b8a6ff'];
  D002_SATISFACTION_COLORS = event.detail?.preset === 'classic'
    ? { 'Высокая удовлетворённость': '#a78bb5', 'Частичная удовлетворённость': '#f0a17e', 'Низкая удовлетворённость': '#b96767', 'Не применимо / затруднились ответить': '#8c828d' }
    : { 'Высокая удовлетворённость': '#7ef5ad', 'Частичная удовлетворённость': '#50b9d2', 'Низкая удовлетворённость': '#a78bfa', 'Не применимо / затруднились ответить': '#687780' };
  d002Charts?.forEach((chart) => {
    const series = chart.getOption().series.map((item) => {
      const data = (item.data || []).map((point) => point && typeof point === 'object' ? point : { value: point });
      const satisfactionScale = data.some((point) => Object.hasOwn(D002_SATISFACTION_COLORS, point.name));
      return {
        ...item,
        data: data.map((point, index) => ({
          ...point,
          itemStyle: { ...point.itemStyle, color: d002AnswerColor(point.name || point.label || '', index, satisfactionScale) }
        }))
      };
    });
    chart.setOption({ color: DATA_COLORS, series });
  });
  d008Charts?.forEach((chart) => {
    chart.setOption({ color: DATA_COLORS });
    chart.__redrawFlowConnections?.();
  });
  ['d002MapChart', 'd004MapChart'].forEach((id) => {
    const chart = window.echarts?.getInstanceByDom(document.getElementById(id));
    chart?.setOption({ visualMap: { inRange: { color: MAP_SCALE } } });
  });
  const activeQuestion = d002FilteredQuestions[d002QuestionIndex];
  if (activeQuestion && !document.getElementById('d002MapPanel')?.hidden) void renderD002Map(activeQuestion);
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
let d002FilteredQuestions = [];
let d002QuestionIndex = 0;
let d002Map = null;
let d002MapGeoJSON = null;
let d002MapRevision = 0;
let d002MapRegions = [];
let d002MapData = null;
let d006Charts = new Map();
let d006BaseResult = null;
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
  if (!element || !window.echarts || !question) return;
  const years = question.yearly?.length ? question.yearly : [question];
  if (!years.some((item) => item.distribution?.length)) return;
  const chart = window.echarts.getInstanceByDom(element) || window.echarts.init(element);
  d002Charts.set(element, chart);
  const styles = getComputedStyle(element.closest('.dataset-panel') || element);
  const textColor = styles.getPropertyValue('--text-primary').trim() || '#222222';
  const categories = new Map();
  years.forEach((item) => (item.distribution || []).forEach((answer) => categories.set(String(answer.code ?? answer.label), answer.label)));
  const trend = years.length > 1;
  const pieSeries = years.map((year, index) => ({
    name: String(year.year || question.year || ''),
    type: 'pie',
    radius: trend ? [`${Math.max(5, Math.min(14, 22 / years.length))}%`, `${Math.max(12, Math.min(32, 44 / years.length))}%`] : ['30%', '66%'],
    center: trend ? [`${((index + .5) / years.length) * 100}%`, '46%'] : ['50%', '48%'],
    minAngle: 2,
    avoidLabelOverlap: true,
    itemStyle: { borderColor: styles.backgroundColor || '#fff', borderWidth: 2, borderRadius: 3 },
    label: { show: !trend && categories.size <= 7, position: 'outside', formatter: '{b}\n{c}', color: textColor, fontSize: 10 },
    emphasis: { scale: true, scaleSize: 7, label: { show: true, formatter: '{b}\n{c}', color: textColor, fontSize: 12, fontWeight: 700 } },
    data: [...categories.entries()].map(([code, label], categoryIndex) => {
      const answer = (year.distribution || []).find((item) => String(item.code ?? item.label) === code);
      return { name: label, value: Number(answer?.count || 0), itemStyle: { color: d002AnswerColor(label, categoryIndex, question.is_satisfaction_scale) } };
    }).filter((item) => item.value > 0)
  }));
  chart.setOption({
    tooltip: {
      trigger: 'item',
      confine: true,
      formatter: (point) => `${point.seriesName}<br>${point.name}<br><strong>${Number(point.value).toLocaleString('ru-RU')} ответов</strong>`
    },
    title: trend ? years.map((year, index) => ({ text: String(year.year), left: `${((index + .5) / years.length) * 100}%`, top: 8, textAlign: 'center', textStyle: { color: textColor, fontSize: 13 } })) : undefined,
    legend: { type: 'scroll', bottom: 0, left: 10, right: 10, textStyle: { color: textColor, fontSize: 12 }, data: [...categories.values()] },
    toolbox: { right: 8, feature: { dataView: { readOnly: true }, restore: {}, saveAsImage: {} } },
    series: pieSeries
  }, true);
  chart.resize();
}

function renderD002Question() {
  d002FilteredQuestions = d002Questions;
  if (d002QuestionIndex >= d002FilteredQuestions.length) d002QuestionIndex = Math.max(0, d002FilteredQuestions.length - 1);
  disposeD002Charts();
  const question = d002FilteredQuestions[d002QuestionIndex];
  const empty = !question;
  const hasAnswers = Boolean(question?.distribution?.length || question?.yearly?.some((year) => year.distribution?.length));
  document.getElementById('d002NoAnswers').hidden = empty || hasAnswers;
  document.getElementById('d002QuestionChart').hidden = empty || !hasAnswers;
  document.getElementById('d002QuestionInfo').hidden = empty;
  document.getElementById('d002PreviousQuestion').disabled = empty || d002QuestionIndex === 0;
  document.getElementById('d002NextQuestion').disabled = empty || d002QuestionIndex >= d002FilteredQuestions.length - 1;
  setText('d002QuestionPosition', empty ? 'Нет вопросов' : `Вопрос ${d002QuestionIndex + 1} из ${d002FilteredQuestions.length}`);
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
  setText('d002TotalCount', Number(question.answered + question.missing).toLocaleString('ru-RU'));
  setText('d002QuestionNote', question.chart_note || 'На диаграмме показано точное число ответов каждого типа.');
  setText('d002ChartCaption', question.yearly?.length > 1
    ? `Круги показывают точное число ответов за каждый год отдельно; значения между годами не суммируются.`
    : `${Number(question.answered).toLocaleString('ru-RU')} ответов. Сектора показывают их точное число за ${question.year || 'выбранный год'}.`);
  if (hasAnswers) {
    renderD002QuestionChart(document.getElementById('d002QuestionChart'), question);
    renderD002Map(question);
  } else {
    document.getElementById('d002MapPanel').hidden = true;
    d002MapRevision += 1;
  }
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
  if (!(question.distribution?.length || question.yearly?.some((item) => item.distribution?.length))) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const params = new URLSearchParams({
    year: document.getElementById('d002YearSelect').value,
    form: document.getElementById('d002FormSelect').value,
    question: question.id
  });
  setText('d002MapStatus', 'Считаем число ответов по территориям…');
  setText('d002RegionTitle', 'Выберите область на карте');
  document.getElementById('d002RegionStats').hidden = true;
  let response;
  try {
    const selectedYear = document.getElementById('d002YearSelect').value;
    const mapYear = selectedYear === 'trend' ? question.yearly?.at(-1)?.year : selectedYear;
    params.set('year', mapYear || selectedYear);
    const mapKey = `${mapYear || selectedYear}:${params.get('form')}:${question.id}`;
    let result = d002MapData?.key === mapKey ? d002MapData.result : null;
    if (!result) {
      response = await fetch(`${activeApiUrl}/api/d002/map?${params}`);
      result = await response.json().catch(() => ({}));
      if (response.ok) d002MapData = { key: mapKey, result };
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
    const territoryFilter = document.getElementById('d002MapTerritoryFilter');
    const answerFilter = document.getElementById('d002MapAnswerFilter');
    if (territoryFilter) appendOptions(territoryFilter, [{ code: '', territory: 'Все области' }, ...result.regions], (item) => item.code, (item) => item.territory);
    if (answerFilter) appendOptions(answerFilter, [{ code: '', label: 'Все варианты' }, ...result.categories], (item) => item.code, (item) => item.label);
    const selectedRegion = territoryFilter?.value || '';
    const selectedAnswer = answerFilter?.value || '';
    const visibleRegions = result.regions.filter((region) => !selectedRegion || region.code === selectedRegion);
    setText('d002MapStatus', 'Каждый круг — область. Цвета соответствуют вариантам ответа в легенде. Наведите курсор или нажмите на круг, чтобы увидеть точные числа.');
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
    const satisfactionScale = result.categories.some((category) => Object.hasOwn(D002_SATISFACTION_COLORS, category.label));
    if (satisfactionScale) setText('d002MapStatus', 'Каждый круг — область. Цвета показывают высокий, частичный и низкий уровни удовлетворённости. Наведите курсор или нажмите на круг, чтобы увидеть точные числа.');
    d002Map.setOption({
      color: result.categories.map((category, index) => d002AnswerColor(category.label, index, satisfactionScale)),
      tooltip: {
        trigger: 'item',
        formatter: (item) => {
          const region = d002MapRegions.find((entry) => entry.code === item.data?.regionCode);
          return region && item.data?.count != null
            ? `${region.territory}<br>${item.name}: <strong>${Number(item.data.count).toLocaleString('ru-RU')}</strong><br>Всего ответов: ${Number(region.answered).toLocaleString('ru-RU')}`
            : `${item.seriesName || item.name}`;
        }
      },
      legend: {
        type: 'scroll', bottom: 2, left: 'center', data: result.categories.filter((item) => !selectedAnswer || item.code === selectedAnswer).map((item) => item.label),
        textStyle: { color: dark ? '#d4e4d4' : '#48534b', fontSize: 13 },
        pageTextStyle: { color: dark ? '#d4e4d4' : '#48534b' }
      },
      geo: {
        map: 'KZ_D002', roam: true, zoom: 3.1, layoutCenter: ['0%', '135%'], layoutSize: '98%',
        itemStyle: { areaColor: dark ? '#48534b' : '#8b9298', borderColor: dark ? '#b8d6a0' : '#40684c', borderWidth: 1.1 },
        emphasis: { itemStyle: { areaColor: dark ? '#34584d' : '#d4e4d4' }, label: { show: true, color: dark ? '#fff' : '#293a30', fontSize: 13 } },
        label: { show: false }
      },
      series: visibleRegions.filter((region) => d002RegionCoordinates[region.code]).map((region) => {
        const selectedAnswerCount = Number(region.distribution.find((answer) => answer.code === selectedAnswer)?.count || 0);
        const maxSelectedAnswerCount = Math.max(1, ...result.regions.map((regionItem) => Number(regionItem.distribution.find((answer) => answer.code === selectedAnswer)?.count || 0)));
        const radius = selectedAnswer ? Math.max(7, Math.round(22 * Math.sqrt(selectedAnswerCount / maxSelectedAnswerCount))) : 18;
        return {
        name: region.territory,
        type: 'pie',
        coordinateSystem: 'geo',
        geoIndex: 0,
        center: d002RegionCoordinates[region.code],
        radius,
        minShowLabelAngle: 8,
        avoidLabelOverlap: true,
        itemStyle: { borderColor: dark ? '#2c282d' : '#fff', borderWidth: 1, borderRadius: 2 },
        label: { show: false },
        emphasis: { scale: true, scaleSize: 5, label: { show: true, formatter: '{b}\n{c}', color: dark ? '#fff' : '#293a30', fontSize: 13, fontWeight: 700 } },
        data: region.distribution.filter((answer) => !selectedAnswer || answer.code === selectedAnswer).map((answer) => ({
          name: answer.label, value: answer.count,
          count: answer.count, regionCode: region.code,
          itemStyle: { color: d002AnswerColor(answer.label, result.categories.findIndex((category) => category.code === answer.code), satisfactionScale) }
        }))
      };
      })
    }, true);
    d002Map.off('click');
    d002Map.on('click', (params) => {
      const region = d002MapRegions.find((entry) => entry.territory === params.seriesName);
      if (region) showD002RegionDetails(region);
    });
    d002Map.resize();
    setText('d002MapCaption', `${question.label} · ${mapYear}. В секторах и подсказках показано точное число ответов; круги сравнивают состав ответов между регионами.`);
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
  const satisfactionScale = region.distribution.some((item) => Object.hasOwn(D002_SATISFACTION_COLORS, item.label));
  region.distribution.forEach((item, index) => {
    const row = document.createElement('article');
    row.className = 'd002-region-answer';
    row.style.setProperty('--answer-color', d002AnswerColor(item.label, index, satisfactionScale));
    const heading = document.createElement('div');
    heading.className = 'd002-region-answer-heading';
    const label = document.createElement('span');
    label.textContent = item.label;
    const value = document.createElement('strong');
    value.textContent = Number(item.count).toLocaleString('ru-RU');
    heading.append(label, value);
    const track = document.createElement('div');
    track.className = 'd002-region-answer-track';
    track.setAttribute('aria-hidden', 'true');
    const bar = document.createElement('span');
    bar.style.width = `${Math.max(0, Math.min(100, Number(item.count) / Math.max(1, Number(region.answered)) * 100))}%`;
    track.append(bar);
    row.append(heading, track);
    stats.append(row);
  });
  stats.hidden = false;
}

function renderD006Pie(id, items) {
  const element = document.getElementById(id);
  if (!element || !window.echarts || !items?.length) return;
  const chart = window.echarts.getInstanceByDom(element) || window.echarts.init(element);
  d006Charts.set(id, chart);
  const panel = element.closest('.d006-chart-panel');
  const textColor = getComputedStyle(panel).getPropertyValue('--text-primary').trim() || '#222';
  chart.setOption({
    color: DATA_COLORS,
    tooltip: { trigger: 'item', formatter: ({ name, data }) => `${name}<br><strong>${Number(data.count).toLocaleString('ru-RU')} домохозяйств</strong>` },
    legend: { type: 'scroll', bottom: 4, left: 'center', textStyle: { color: textColor, fontSize: 12 } },
    series: [{ type: 'pie', radius: ['28%', '62%'], center: ['50%', '43%'], minAngle: 2, avoidLabelOverlap: true,
      itemStyle: { borderColor: getComputedStyle(element.closest('.d006-chart-panel')).backgroundColor, borderWidth: 2, borderRadius: 3 },
      label: { show: true, position: 'outside', formatter: '{b}\n{c}', color: textColor, fontSize: 12 },
      labelLine: { show: true, length: 12, length2: 8 },
      emphasis: { scale: true, label: { show: true, color: textColor, formatter: '{b}\n{c}' } },
      data: items.map((item) => ({ name: item.label, value: Number(item.count), count: Number(item.count), share: Number(item.share) })) }]
  }, true);
  chart.resize();
}

function renderD006Bars(id, items) {
  const element = document.getElementById(id);
  if (!element || !window.echarts || !items?.length) return;
  const chart = window.echarts.getInstanceByDom(element) || window.echarts.init(element);
  d006Charts.set(id, chart);
  const styles = getComputedStyle(element.closest('.d006-chart-panel'));
  const metric = element.closest('.d006-chart-panel')?.dataset.d006Chart || '';
  const textColor = styles.getPropertyValue('--text-primary').trim() || '#222222';
  const limit = Number(element.closest('.d006-chart-panel')?.querySelector('[data-d006-filter="limit"]')?.value || 0);
  const sorted = [...items].sort((a, b) => Number(b.count) - Number(a.count));
  const visible = limit ? sorted.slice(0, limit) : sorted;
  // Keep every category readable without ECharts dataZoom/scrollbars.
  // Long lists (amenities and durable goods) grow with the number of rows.
  if (metric === 'amenities' || metric === 'durable_goods') {
    element.style.height = `${Math.max(680, visible.length * 28 + 120)}px`;
  }
  const axisConfig = {
    home_types: { x: 'Домохозяйства, шт.', y: 'Тип жилья' },
    ownership: { x: 'Домохозяйства, шт.', y: 'Владение жильём' },
    amenities: { x: 'Ответы «да», шт.', y: 'Удобства' },
    durable_goods: { x: 'Предметы, шт.', y: 'Товары' }
  }[metric] || { x: 'Домохозяйства, шт.', y: 'Категория' };
  const unitLabel = metric === 'amenities' ? 'ответов «да»' : metric === 'durable_goods' ? 'предметов' : 'домохозяйств';
  const shareRamp = ['#d74747', '#f39437', '#f0cf4a', '#a8c94a', '#168849'];
  const shareColor = (share) => shareRamp[Math.min(4, Math.floor(Math.max(0, Math.min(100, Number(share) || 0)) / 20))];
  const compact = element.clientWidth < 620;
  const axisLabelWidth = compact ? 120 : metric === 'durable_goods' ? 260 : 240;
  chart.setOption({
    color: DATA_COLORS,
    tooltip: { trigger: 'item', formatter: (point) => {
      const item = visible[point.dataIndex];
      const share = item.share == null ? '' : `<br>Доля: ${Number(item.share).toLocaleString('ru-RU')}%`;
      return `${item.label}<br><strong>${Number(item.count).toLocaleString('ru-RU')} ${unitLabel}</strong>${share}`;
    } },
    grid: { left: axisLabelWidth + 56, right: compact ? 52 : 72, top: 24, bottom: compact ? 68 : 76, containLabel: true },
    xAxis: {
      type: 'value', min: 0, minInterval: 1, splitNumber: compact ? 3 : 4,
      name: axisConfig.x, nameLocation: 'middle', nameGap: compact ? 36 : 42,
      nameTextStyle: { color: textColor, fontWeight: 700, fontSize: compact ? 10 : 12 },
      axisLabel: {
        color: textColor, fontSize: compact ? 9 : 10,
        formatter: (value) => Number(value) >= 10000
          ? `${Number(value / 1000).toLocaleString('ru-RU')} тыс.`
          : Number(value).toLocaleString('ru-RU')
      },
      splitLine: { lineStyle: { type: 'dashed', color: 'rgba(184,214,160,.23)' } }
    },
    yAxis: {
      type: 'category', inverse: true, data: visible.map((item) => item.label),
      name: axisConfig.y, nameLocation: 'middle', nameGap: axisLabelWidth + (compact ? 24 : 32),
      nameTextStyle: { color: textColor, fontWeight: 700, fontSize: compact ? 10 : 12 },
      axisLabel: { color: textColor, interval: 0, width: axisLabelWidth - 12, overflow: 'truncate', fontSize: compact ? 9 : 11 },
      axisTick: { show: false }, axisLine: { show: false }
    },
    series: [{
      type: 'bar', barMaxWidth: 30,
      data: visible.map((item, index) => ({
        value: Number(item.count || 0),
        itemStyle: {
          color: item.share == null ? '#31b99a' : shareColor(item.share),
          borderRadius: [0, 5, 5, 0]
        }
      })),
      label: { show: true, position: 'right', color: textColor, fontSize: compact ? 9 : 11, formatter: ({ value }) => Number(value).toLocaleString('ru-RU') }
    }]
  }, true);
  chart.resize();
}

function initializeD006ChartFilters(territoryOptions) {
  document.querySelectorAll('[data-d006-chart]').forEach((panel) => {
    let details = panel.querySelector('.d006-chart-filter-details');
    if (!details) {
      details = document.createElement('details');
      details.className = 'd006-chart-filter-details';
      const summary = document.createElement('summary');
      summary.textContent = 'Фильтры графика';
      const controls = document.createElement('div');
      controls.className = 'd006-chart-filter-grid';
      const territoryLabel = document.createElement('label');
      territoryLabel.textContent = 'Территория';
      const territorySelect = document.createElement('select');
      territorySelect.dataset.d006Filter = 'territory';
      territoryLabel.append(territorySelect);
      controls.append(territoryLabel);
      if (!['city_rural', 'land_access'].includes(panel.dataset.d006Chart)) {
        const limitLabel = document.createElement('label');
        limitLabel.textContent = 'Категории';
        const limit = document.createElement('select');
        limit.dataset.d006Filter = 'limit';
        limit.append(new Option('Все', '0'), new Option('Первые 10', '10'), new Option('Первые 20', '20'));
        limitLabel.append(limit);
        controls.append(limitLabel);
      }
      const reset = document.createElement('button');
      reset.className = 'filter-reset-button';
      reset.type = 'button';
      reset.textContent = 'Сброс фильтра';
      reset.addEventListener('click', () => {
        controls.querySelectorAll('select').forEach((control) => { control.selectedIndex = 0; });
        refreshD006Chart(panel);
      });
      controls.append(reset);
      details.append(summary, controls);
      panel.insertBefore(details, panel.querySelector('.dataset-chart'));
      controls.addEventListener('change', () => refreshD006Chart(panel));
    }
    const territorySelect = panel.querySelector('[data-d006-filter="territory"]');
    if (territorySelect) {
      const previous = territorySelect.value;
      territorySelect.replaceChildren(new Option('Все области', ''));
      territoryOptions.forEach((item) => territorySelect.append(new Option(item.label, item.code)));
      if (territoryOptions.some((item) => item.code === previous)) territorySelect.value = previous;
      else territorySelect.value = '';
    }
  });
}

async function refreshD006Chart(panel) {
  const metric = panel.dataset.d006Chart;
  const chartId = panel.querySelector('.dataset-chart')?.id;
  const selectedTerritory = panel.querySelector('[data-d006-filter="territory"]')?.value || '';
  const keyMap = { home_types: 'home_types', ownership: 'ownership', city_rural: 'city_rural', land_access: 'land_access', amenities: 'amenities', durable_goods: 'durable_goods' };
  const currentId = String(Number(panel.dataset.requestId || 0) + 1);
  panel.dataset.requestId = currentId;
  try {
    let result = d006BaseResult;
    if (selectedTerritory) {
      const params = new URLSearchParams({ year: String(d006BaseResult.year), territory: selectedTerritory });
      const response = await fetch(`${activeApiUrl}/api/d006/data?${params}`);
      result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Не удалось применить фильтр территории.');
    }
    if (panel.dataset.requestId !== currentId) return;
    const items = result?.[keyMap[metric]] || [];
    if (metric === 'land_access' || metric === 'city_rural') renderD006Pie(chartId, items);
    else renderD006Bars(chartId, items);
    const unit = panel.querySelector('.d006-chart-unit');
    if (unit) unit.textContent = metric === 'amenities' ? 'точное число ответов «да»' : metric === 'durable_goods' ? 'точное количество предметов' : 'точное число домохозяйств';
  } catch (error) {
    if (panel.dataset.requestId === currentId) panel.querySelector('.dataset-chart')?.setAttribute('aria-label', error.message);
  }
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
    d006BaseResult = result;
    initializeD006ChartFilters(result.territory_options || []);
    setText('d006RespondentsStat', Number(result.respondents).toLocaleString('ru-RU'));
    setText('d006TerritoriesStat', Number(result.territories).toLocaleString('ru-RU'));
    setText('d006TotalAreaStat', result.average_total_area == null ? '—' : `${Number(result.average_total_area).toLocaleString('ru-RU')} м²`);
    setText('d006LivingAreaStat', result.average_living_area == null ? '—' : `${Number(result.average_living_area).toLocaleString('ru-RU')} м²`);
    setText('d006RoomsStat', result.average_rooms == null ? '—' : Number(result.average_rooms).toLocaleString('ru-RU'));
    document.querySelectorAll('[data-d006-chart]').forEach((panel) => void refreshD006Chart(panel));
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
      document.getElementById('d006ResetFilters').addEventListener('click', () => {
        document.getElementById('d006YearSelect').value = preferredDatasetYear(options.years);
        document.querySelectorAll('[data-d006-filter]').forEach((control) => {
          control.value = control.dataset.d006Filter === 'limit' ? '0' : '';
        });
        loadD006Page();
      });
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
  const totals = yearlyResults.map((result) => categoryEntries.reduce((sum, [code]) => {
    const item = (result[metric] || []).find((entry) => String(entry.code ?? entry.label) === code);
    return sum + Number(item?.count || 0);
  }, 0));
  const householdSizeChart = metric === 'household_sizes';
  const horizontalChart = householdSizeChart || ['relationships', 'education', 'activity'].includes(metric);
  const flowChart = !householdSizeChart && !horizontalChart;
  const formatValue = (value) => `${Number(value).toLocaleString('ru-RU', { maximumFractionDigits: valueMode === 'share' ? 1 : 0 })}${suffix}`;
  const series = householdSizeChart
    ? yearlyResults.map((result) => ({
      name: String(result.year),
      type: 'bar',
      barMaxWidth: 26,
      label: {
        show: true, position: 'inside', color: textColor, fontSize: 10,
        formatter: ({ value }) => value == null || (valueMode === 'count' && value < Number(result.households || 0) * 0.05) ? '' : formatValue(value)
      },
      labelLayout: { hideOverlap: true },
      emphasis: { focus: 'series' },
      data: categoryEntries.map(([code]) => {
        const item = (result[metric] || []).find((entry) => String(entry.code ?? entry.label) === code);
        const value = Number(item?.[valueKey] || 0);
        return valueMode === 'share' ? Math.round(value * 10) / 10 : Math.round(value);
      })
    }))
    : categoryEntries.map(([code, label]) => {
    const data = yearlyResults.map((result) => {
      if ((metric === 'age_structure' || metric === 'household_sizes') && !result.age_available && metric === 'age_structure') return null;
      const item = (result[metric] || []).find((entry) => String(entry.code ?? entry.label) === code);
      const value = Number(item?.[valueKey] || 0);
      return valueMode === 'share' ? Math.round(value * 10) / 10 : Math.round(value);
    });
    if (horizontalChart) return {
      name: label, type: 'bar', stack: 'total', barMaxWidth: 34,
      label: {
        show: true, position: 'inside', color: textColor, fontSize: 10,
        formatter: ({ value, dataIndex }) => {
          if (value == null) return '';
          // Small stacked segments cannot fit their labels and make adjacent
          // values look like one incorrect number. Their exact values remain
          // available in the tooltip and the table below the chart.
          if (metric !== 'household_sizes' && valueMode === 'count' && value < (totals[dataIndex] || 0) * 0.05) return '';
          return formatValue(value);
        }
      },
      labelLayout: { hideOverlap: true }, emphasis: { focus: 'series' }, data
    };
    return {
      name: label, type: 'bar', stack: 'total', barWidth: '60%',
      label: { show: true, position: 'inside', color: textColor, fontSize: 10, formatter: ({ value }) => value == null ? '' : formatValue(value) },
      labelLayout: { hideOverlap: true }, emphasis: { focus: 'series' }, data
    };
  });

  chart.setOption({
    animationDuration: 350,
    color: DATA_COLORS,
    tooltip: {
      trigger: 'item',
      confine: true,
      formatter: (point) => {
        const value = point.value == null ? '—' : Number(point.value).toLocaleString('ru-RU');
        return `${point.name || ''}<br>${point.marker}${point.seriesName}: <strong>${value}${suffix}</strong>`;
      }
    },
    legend: { type: 'scroll', bottom: 0, left: 8, right: 8, height: 48, itemWidth: 12, itemHeight: 8, textStyle: { color: textColor, fontSize: 12 } },
    toolbox: { right: 8, feature: { saveAsImage: {} } },
    grid: { left: householdSizeChart ? 100 : horizontalChart ? 145 : 58, right: 42, top: 44, bottom: 82, containLabel: true },
    xAxis: horizontalChart
      ? { type: 'value', min: 0, name: householdSizeChart ? 'Количество домохозяйств' : '', nameLocation: 'middle', nameGap: 34, nameTextStyle: { color: textColor, fontSize: 12, fontWeight: 600 }, axisLabel: { color: textColor, formatter: (value) => `${Number(value).toLocaleString('ru-RU')}${suffix}` }, splitLine: { lineStyle: { color: 'rgba(139, 146, 152, .2)' } } }
      : { type: 'category', boundaryGap: true, data: yearlyResults.map((result) => String(result.year)), axisLabel: { color: textColor, fontSize: 13 }, axisLine: { lineStyle: { color: 'rgba(139, 146, 152, .45)' } }, axisTick: { show: false } },
    yAxis: horizontalChart
      ? { type: 'category', name: householdSizeChart ? 'Число членов домохозяйства' : '', nameLocation: 'middle', nameGap: 76, nameRotate: 90, nameTextStyle: { color: textColor, fontSize: 12, fontWeight: 600 }, data: householdSizeChart ? categoryEntries.map(([, label]) => label) : yearlyResults.map((result) => String(result.year)), axisLabel: { color: textColor, fontSize: 13 }, axisTick: { show: false } }
      : { type: 'value', min: 0, max: flowChart ? (valueMode === 'share' ? 100 : Math.max(...totals, 1)) : undefined, scale: !householdSizeChart && valueMode !== 'share', minInterval: valueMode === 'count' ? 1 : undefined, axisLabel: { color: textColor, fontSize: 12, formatter: (value) => `${Number(value).toLocaleString('ru-RU')}${suffix}` }, splitLine: { lineStyle: { color: 'rgba(139, 146, 152, .2)' } } },
    series
  }, true);
  renderD008ValuesTable(element, yearlyResults, categoryEntries, metric, valueMode);
  if (flowChart && yearlyResults.length > 1) {
    chart.__redrawFlowConnections = () => requestAnimationFrame(() => {
      if (chart.isDisposed()) return;
      const width = chart.getWidth();
      const left = 58;
      const right = 22;
      const categoryWidth = (width - left - right) / yearlyResults.length;
      const elements = [];
      for (let index = 0; index < yearlyResults.length - 1; index += 1) {
        if (metric === 'age_structure' && (!yearlyResults[index].age_available || !yearlyResults[index + 1].age_available)) continue;
        const x1 = Number(chart.convertToPixel({ xAxisIndex: 0 }, index)) + categoryWidth * .3;
        const x2 = Number(chart.convertToPixel({ xAxisIndex: 0 }, index + 1)) - categoryWidth * .3;
        let before = 0;
        let after = 0;
        categoryEntries.forEach(([code], seriesIndex) => {
          const leftItem = (yearlyResults[index][metric] || []).find((item) => String(item.code ?? item.label) === code);
          const rightItem = (yearlyResults[index + 1][metric] || []).find((item) => String(item.code ?? item.label) === code);
          const leftPart = Number(leftItem?.count || 0) / Math.max(1, totals[index]);
          const rightPart = Number(rightItem?.count || 0) / Math.max(1, totals[index + 1]);
          const max = valueMode === 'share' ? 100 : Math.max(...totals, 1);
          const lowerLeft = before * max;
          const upperLeft = (before + leftPart) * max;
          const lowerRight = after * max;
          const upperRight = (after + rightPart) * max;
          const points = [
            [x1, chart.convertToPixel({ yAxisIndex: 0 }, lowerLeft)],
            [x1, chart.convertToPixel({ yAxisIndex: 0 }, upperLeft)],
            [x2, chart.convertToPixel({ yAxisIndex: 0 }, upperRight)],
            [x2, chart.convertToPixel({ yAxisIndex: 0 }, lowerRight)]
          ];
          if (points.every((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))) {
            elements.push({ type: 'polygon', z: -1, shape: { points }, style: { fill: DATA_COLORS[seriesIndex % DATA_COLORS.length], opacity: .22 } });
          }
          before += leftPart;
          after += rightPart;
        });
      }
      chart.setOption({ graphic: { elements } });
    });
    chart.__redrawFlowConnections();
  } else {
    chart.__redrawFlowConnections = null;
  }
  chart.resize();
}

function renderD008ValuesTable(chartElement, yearlyResults, categoryEntries, metric, valueMode) {
  let details = chartElement.parentElement.querySelector('.d008-values-details');
  if (!details) {
    details = document.createElement('details');
    details.className = 'd008-values-details';
    const summary = document.createElement('summary');
    summary.textContent = 'Точные значения по годам';
    const tableScroll = document.createElement('div');
    tableScroll.className = 'd008-values-scroll';
    const table = document.createElement('table');
    table.className = 'd008-values-table';
    tableScroll.append(table);
    details.append(summary, tableScroll);
    chartElement.after(details);
  }

  const table = details.querySelector('table');
  const head = document.createElement('thead');
  const headerRow = document.createElement('tr');
  ['Категория', ...yearlyResults.map((result) => String(result.year))].forEach((label) => {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = label;
    headerRow.append(cell);
  });
  head.append(headerRow);
  const body = document.createElement('tbody');
  const valueKey = valueMode === 'share' ? 'share' : 'count';
  categoryEntries.forEach(([code, label]) => {
    const row = document.createElement('tr');
    const categoryCell = document.createElement('th');
    categoryCell.scope = 'row';
    categoryCell.textContent = label;
    row.append(categoryCell);
    yearlyResults.forEach((result) => {
      const cell = document.createElement('td');
      const item = (result[metric] || []).find((entry) => String(entry.code ?? entry.label) === code);
      const value = item?.[valueKey];
      cell.textContent = value == null ? '—' : `${Number(value).toLocaleString('ru-RU', { maximumFractionDigits: valueMode === 'share' ? 1 : 0 })}${valueMode === 'share' ? '%' : ''}`;
      row.append(cell);
    });
    body.append(row);
  });
  table.replaceChildren(head, body);
}

function setD008SummaryValue(id, yearlyResults, selectedYear, getValue, formatValue) {
  const element = document.getElementById(id);
  if (!element) return;
  element.replaceChildren();
  element.classList.toggle('d008-stat-values', selectedYear === 'dynamic');
  if (selectedYear === 'dynamic') {
    yearlyResults.forEach((result) => {
      const line = document.createElement('span');
      line.textContent = `${result.year}: ${formatValue(getValue(result))}`;
      element.append(line);
    });
    return;
  }
  element.textContent = formatValue(getValue(yearlyResults.at(-1)));
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

function d008DefaultFilterValue(chart, name) {
  return name === 'value_mode'
    ? (['settlement', 'gender', 'marital_status', 'age_structure'].includes(chart) ? 'share' : 'count')
    : '';
}

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
      select.value = d008DefaultFilterValue(panel.dataset.d008Chart, name);
      field.append(select);
      controls.append(field);
      select.addEventListener('change', () => refreshD008Chart(panel));
    });
    const reset = document.createElement('button');
    reset.className = 'filter-reset-button';
    reset.type = 'button';
    reset.textContent = 'Сброс фильтра';
    reset.addEventListener('click', () => {
      controls.querySelectorAll('[data-d008-filter]').forEach((control) => {
        control.value = d008DefaultFilterValue(panel.dataset.d008Chart, control.dataset.d008Filter);
      });
      refreshD008Chart(panel);
    });
    controls.append(reset);
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
    let yearlyResults = Object.keys(filters).length
      ? await Promise.all(d008BaseResults.map(({ year }) => fetchD008Year(year, filters)))
      : d008BaseResults;
    if (panel.dataset.requestId !== currentId) return;
    const latest = yearlyResults.at(-1);
    renderD008Trend(chartId, yearlyResults, metric, valueMode);
    if (yearlyResults.length > 1) {
      setText(unitId, valueMode === 'share' ? 'доля ответов каждого года, %' : `${metric === 'household_sizes' ? 'домохозяйства' : 'ответы'} показаны отдельно по годам`);
    } else {
      const answeredValue = latest?.answered?.[metric] ?? (metric === 'household_sizes' ? latest?.households : latest?.people);
      const answered = Number(answeredValue ?? 0);
      setText(unitId, valueMode === 'share' ? `доля от ${answered.toLocaleString('ru-RU')} ответов, %` : `${metric === 'household_sizes' ? 'домохозяйств' : 'ответов'} · ${answered.toLocaleString('ru-RU')}`);
    }
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
  const selectedYear = document.querySelector('input[name="d008Year"]:checked')?.value || 'dynamic';
  const selectedYears = selectedYear === 'dynamic' ? [...d008AvailableYears] : d008AvailableYears.includes(selectedYear) ? [selectedYear] : [];
  status.dataset.state = 'loading';
  status.textContent = 'Загружаем демографические показатели…';
  try {
    if (!selectedYears.length) throw new Error('Выберите хотя бы один год для сравнения.');
    const yearlyResults = await Promise.all(selectedYears.map((year) => fetchD008Year(year)));
    if (requestId !== d008RequestId) return;
    yearlyResults.sort((a, b) => Number(a.year) - Number(b.year));
    d008BaseResults = yearlyResults;
    disposeD008Charts();
    const latest = yearlyResults.at(-1);
    const periodLabel = selectedYear === 'dynamic' ? 'по годам' : `· ${latest.year}`;
    setText('d008PeopleLabel', `Людей в выборке ${periodLabel}`);
    setText('d008HouseholdsLabel', `Домохозяйств ${periodLabel}`);
    setText('d008HouseholdSizeLabel', `Средний размер домохозяйства ${periodLabel}`);
    setText('d008AverageAgeLabel', `Средний возраст ${periodLabel}`);
    setText('d008ChildrenLabel', `Доля детей младше 15 лет ${periodLabel}`);
    setText('d008TerritoriesLabel', `Территорий ${periodLabel}`);
    const formatCount = (value) => Number(value || 0).toLocaleString('ru-RU');
    const formatDecimal = (value, suffix = '') => value == null ? '—' : `${Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}${suffix}`;
    setD008SummaryValue('d008PeopleStat', yearlyResults, selectedYear, (result) => result.people, formatCount);
    setD008SummaryValue('d008HouseholdsStat', yearlyResults, selectedYear, (result) => result.households, formatCount);
    setD008SummaryValue('d008HouseholdSizeStat', yearlyResults, selectedYear, (result) => result.average_household_size, (value) => formatDecimal(value, ' чел.'));
    setD008SummaryValue('d008AverageAgeStat', yearlyResults, selectedYear, (result) => result.average_age, (value) => formatDecimal(value, ' года'));
    setD008SummaryValue('d008ChildrenStat', yearlyResults, selectedYear, (result) => result.under_15_share, (value) => formatDecimal(value, '%'));
    setD008SummaryValue('d008TerritoriesStat', yearlyResults, selectedYear, (result) => result.territories, formatCount);
    D008_CHARTS.forEach(([metric]) => {
      const panel = document.querySelector(`[data-d008-chart="${metric}"]`);
      if (panel) void refreshD008Chart(panel);
    });
    const yearsLabel = yearlyResults.map((result) => result.year).join(', ');
    const sources = [...new Set(yearlyResults.map((result) => result.source === 'database.sqlite' ? 'database.sqlite' : 'CSV в data/sinte'))].join(', ');
    setText('d008SourceNote', `${selectedYear === 'dynamic' ? `Динамика за ${yearsLabel}` : `Данные за ${latest.year} год`}; источник: ${sources}. При выборе динамики каждый график и сводная карточка показывают значения по каждому году. В каждой карточке графика можно отдельно настроить фильтры.`);
    status.dataset.state = 'success';
    status.textContent = selectedYear === 'dynamic'
      ? `Динамика за ${yearsLabel}: графики и сводные показатели показаны отдельно по годам.`
      : `Показаны данные за ${latest.year} год: ${Number(latest.people).toLocaleString('ru-RU')} человек и ${Number(latest.households).toLocaleString('ru-RU')} домохозяйств.`;
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
      input.disabled = input.value !== 'dynamic' && !d008AvailableYears.includes(input.value);
      if (isFirstInitialization) input.checked = input.value === 'dynamic';
      if (input.disabled && input.checked) document.querySelector('input[name="d008Year"][value="dynamic"]').checked = true;
    });
    if (!dashboard.dataset.listenersReady) {
      initializeD008ChartFilters();
      document.querySelectorAll('input[name="d008Year"]').forEach((control) => control.addEventListener('change', loadD008Page));
      document.getElementById('d008ResetFilters').addEventListener('click', () => {
        document.querySelector('input[name="d008Year"][value="dynamic"]').checked = true;
        document.querySelectorAll('[data-d008-filter]').forEach((control) => {
          const chart = control.closest('[data-d008-chart]')?.dataset.d008Chart;
          control.value = d008DefaultFilterValue(chart, control.dataset.d008Filter);
        });
        loadD008Page();
      });
      window.addEventListener('resize', () => d008Charts.forEach((chart) => { chart.resize(); chart.__redrawFlowConnections?.(); }));
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
    d002Questions = result.questions;
    d002QuestionIndex = 0;
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
      document.getElementById('d002ResetFilters').addEventListener('click', () => {
        document.getElementById('d002YearSelect').value = preferredDatasetYear(availableYears);
        document.getElementById('d002FormSelect').selectedIndex = 0;
        d002QuestionIndex = 0;
        loadD002Page();
      });
      document.getElementById('d002PreviousQuestion').addEventListener('click', () => {
        if (d002QuestionIndex > 0) { d002QuestionIndex -= 1; renderD002Question(); }
      });
      document.getElementById('d002NextQuestion').addEventListener('click', () => {
        if (d002QuestionIndex < d002FilteredQuestions.length - 1) { d002QuestionIndex += 1; renderD002Question(); }
      });
      ['d002MapTerritoryFilter', 'd002MapAnswerFilter'].forEach((id) => {
        document.getElementById(id).addEventListener('change', () => renderD002Map(d002FilteredQuestions[d002QuestionIndex]));
      });
      document.getElementById('d002MapResetFilters').addEventListener('click', () => {
        document.getElementById('d002MapTerritoryFilter').value = '';
        document.getElementById('d002MapAnswerFilter').value = '';
        renderD002Map(d002FilteredQuestions[d002QuestionIndex]);
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
  const isCost = /STOIMK|стоимост/i.test(metric);
  d004Chart.setOption({
    color: colors,
    tooltip: { trigger: 'item', textStyle: { color: '#222' }, formatter: (point) => `${point.name}<br>${point.marker}${point.seriesName}: <strong>${Number(point.value).toLocaleString('ru-RU')}${isCost ? ' ₸' : ''}</strong>` },
    grid: { left: 72, right: 28, top: 56, bottom: 142, containLabel: true },
    xAxis: {
      type: 'category',
      data: chartData.labels,
      axisLabel: { rotate: 35, interval: 0, color: textColor, fontSize: 12, margin: 12 },
      name: 'Область', nameLocation: 'middle', nameGap: 112, nameTextStyle: { color: textColor, fontSize: 13, fontWeight: 700 },
      axisLine: { lineStyle: { color: dark ? '#48534b' : '#d9ced6' } }
    },
    yAxis: { type: 'value', name: isCost ? 'Стоимость, ₸' : 'Записей', minInterval: 1, splitNumber: 5, axisLabel: { color: textColor, fontSize: 12, formatter: (value) => Number(value).toLocaleString('ru-RU') }, nameTextStyle: { color: textColor, fontWeight: 700, fontSize: 13 }, splitLine: { lineStyle: { color: dark ? 'rgba(255,255,255,.08)' : 'rgba(34,34,34,.08)' } } },
    series: [{
      name: metric,
      type: 'bar',
      data: chartData.values.map((value, index) => ({ value, itemStyle: { color: colors[index % colors.length] } })),
      barMaxWidth: 42,
      label: { show: true, position: 'top', color: textColor, fontSize: 8, formatter: ({ value }) => Number(value).toLocaleString('ru-RU') },
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
        type: 'map', map: 'KZ_D004', roam: true, zoom: 3.1, layoutCenter: ['0%', '145%'], layoutSize: '108%', selectedMode: 'single', data,
        itemStyle: { areaColor: document.body.classList.contains('dark-theme') ? '#48534b' : '#8b9298', borderColor: document.body.classList.contains('dark-theme') ? '#b8d6a0' : '#fff', borderWidth: 1 },
        emphasis: { label: { show: true, formatter: (params) => `${params.name}\n${params.value == null ? 'Нет данных' : Number(params.value).toLocaleString('ru-RU')}`, fontSize: 10 } },
        select: { itemStyle: { areaColor: '#7ef5ad', borderColor: '#17b981', borderWidth: 2 }, label: { show: true, color: '#222222', formatter: (params) => `${params.name}\n${params.value == null ? 'Нет данных' : Number(params.value).toLocaleString('ru-RU')}`, fontSize: 10 } }
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
        tooltip: { trigger: 'item', formatter: (point) => `${point.name}<br>${point.marker}<strong>${Number(point.value).toLocaleString('ru-RU')}</strong>` },
        grid: { left: 42, right: 12, top: 12, bottom: 46, containLabel: true },
        xAxis: { type: 'category', data: regions.map((item) => item.territory), axisLabel: { rotate: 35, fontSize: 10, interval: 0 } },
        yAxis: { type: 'value', minInterval: 1 },
        series: [{ type: 'bar', barMaxWidth: 24, data: regions.map((item, index) => ({ value: Number(item.records), itemStyle: { color: colors[index % colors.length], borderRadius: [4, 4, 0, 0] } })), label: { show: true, position: 'top', fontSize: 9, formatter: ({ value }) => Number(value).toLocaleString('ru-RU') }, labelLayout: { hideOverlap: true } }]
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
    const territoryNames = new Map((result.territory_summary || []).map((item) => [String(item.code), item.territory]));
    renderD004Chart({ ...result.chart, labels: result.chart.labels.map((code) => territoryNames.get(String(code)) || code) }, result.chart_metric, result.module_label, result.year, result.quarter);
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
    document.getElementById('d004QuarterSelect').value = 'all';
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
      document.getElementById('d004ResetFilters').addEventListener('click', () => {
        document.getElementById('d004YearSelect').value = preferredDatasetYear(options.years);
        document.getElementById('d004QuarterSelect').value = 'all';
        document.getElementById('d004ModuleSelect').value = '1';
        currentPage = 1;
        renderD004QuestionnaireCards(options.modules);
        loadD004Page();
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
      document.getElementById('d004MapResetFilter').addEventListener('click', () => {
        document.getElementById('d004MapMetric').value = 'records';
        updateD004MapMetric();
      });
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
