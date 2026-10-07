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
    description: 'Демографические данные Казахстана. Выберите общий дашборд для просмотра текущих демографических графиков.'
  },
  d004: {
    title: 'Доходы и расходы домохозяйств',
    breadcrumb: 'Население · Уровень жизни · D004',
    description: 'Ежеквартальное обследование доходов и расходов домашних хозяйств. Данные сгруппированы по году, кварталу и разделу анкеты.'
  },
  d006: {
    title: 'Жилищные условия',
    breadcrumb: 'Население · Жилищные условия',
    description: 'Раздел жилищной статистики. Данные можно будет подключить к этой странице отдельно.'
  },
  d002: {
    title: 'Социальные оценки',
    breadcrumb: 'Население · Социальные оценки · D002',
    description: 'Обследование качества жизни и оценок населения. Данные D002 будут подключены отдельным этапом.'
  }
};

let activeApiUrl = '';
let currentPage = 1;
let totalRows = 0;
let d004Chart = null;
let d004Map = null;
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
  select.replaceChildren();
  items.forEach((item) => {
    const option = document.createElement('option');
    option.value = valueOf(item);
    option.textContent = labelOf(item);
    select.append(option);
  });
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
  d004Chart.setOption({
    color: ['#2563eb'],
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 48, right: 24, top: 24, bottom: 68, containLabel: true },
    xAxis: {
      type: 'category',
      data: chartData.labels,
      axisLabel: { rotate: 35, interval: 0 }
    },
    yAxis: { type: 'value', name: metric === 'Количество записей' ? 'Записей' : 'Значение', minInterval: 1 },
    series: [{
      name: metric,
      type: 'bar',
      data: chartData.values,
      barMaxWidth: 42,
      itemStyle: { borderRadius: [5, 5, 0, 0] }
    }],
    title: {
      text: `${moduleLabel} · ${year}, ${quarter.toUpperCase()}`,
      left: 'center',
      textStyle: { fontSize: 13, fontWeight: 500 }
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
      visualMap: { min: low, max: high, left: 'right', bottom: 24, calculable: true, inRange: { color: ['#dbeafe', '#60a5fa', '#1d4ed8'] } },
      series: [{
        type: 'map', map: 'KZ_D004', roam: true, zoom: 1.35, selectedMode: 'single', data,
        emphasis: { label: { show: true } },
        select: { itemStyle: { areaColor: '#f59e0b', borderColor: '#92400e', borderWidth: 2 }, label: { show: true, color: '#111827' } }
      }]
    }, true);
    setText('d004MapCaption', `${metricConfig.label} · ${period}. Наведите курсор для быстрой подсказки или нажмите на регион для подробностей.`);
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
    if (options.years.includes('2024')) document.getElementById('d004YearSelect').value = '2024';
    document.getElementById('d004QuarterSelect').value = '4kv';
    document.getElementById('d004ModuleSelect').value = '1';

    if (!dashboard.dataset.listenersReady) {
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
  const section = document.getElementById('datasetViewSection');
  section.style.display = 'block';
  setText('datasetPageTitle', page.title);
  setText('datasetPageBreadcrumb', page.breadcrumb);
  setText('datasetPageDescription', page.description);

  const d004 = datasetId === 'd004';
  document.getElementById('d004Dashboard').hidden = !d004;
  document.getElementById('datasetPlaceholder').hidden = d004;
  if (d004) {
    await initializeD004(apiBaseUrl);
  } else {
    const placeholder = document.getElementById('datasetPlaceholder');
    placeholder.replaceChildren();
    const message = document.createElement('p');
    message.textContent = 'Сейчас подключён D004. Этот раздел откроется здесь после подключения его набора данных.';
    placeholder.append(message);
  }
}
