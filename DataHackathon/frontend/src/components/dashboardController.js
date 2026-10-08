import { 
  updateYearChart, 
  updateBarChart,
  updateLineChart,
  updatePieChart,
  updateHBarChart,
  updateSummaryChart, 
  initKazakhstanMap,
  updateStackedAreaChart,
  updateCustomChart
} from './chartsMap.js';
import { renderDynamicSwitchChart } from './dynamicCharts.js';
import { fetchAIInsights } from './insightsTicker.js';
import { setSelectValuePrecise } from './appInit.js';
import { updateChartAnalysis } from './chartAnalysis.js';
import { openSidebarDatasetPage } from './datasetPages.js';
<<<<<<< HEAD
=======
import { startAppLoading, transitionAppPage } from './loadingIndicator.js';
>>>>>>> dc8732dbe208308ef095b862befeb070e1b443be

const categoryDashboards = {
  "Население": [
    "Естественный прирост населения, человек",
    "Число зарегистрированных браков, человек",
    "Число зарегистрированных разводов, человек",
    "Число умерших, человек",
    "Рождаемость, человек",
    "Городское население, человек"
  ],
  "Экономика": [
    "ВРП, млн тенге",
    "Средняя зарплата, тенге",
    "Уровень безработицы, %",
    "Инвестиции в основной капитал",
    "Объем розничной торговли",
    "Индекс потребительских цен"
  ],
  "Образование": [
    "Люди с высшим образованием, человек",
    "Студенты вузов, человек",
    "Охват дошкольным воспитанием",
    "Количество дневных общеобразовательных школ",
    "Численность учащихся",
    "Численность учителей"
  ],
  "Промышленность": [
    "Промышленное производство, млн тенге",
    "Добыча полезных ископаемых",
    "Обрабатывающая промышленность",
    "Производство электроэнергии",
    "Инвестиции в промышленность",
    "Индекс физического объема"
  ],
  "Сельское хозяйство": [
    "Валовой выпуск продукции сельского хозяйства, млн тенге",
    "Производство мяса, тысяч тонн",
    "Производство молока, тысяч тонн",
    "Посевные площади сельскохозяйственных культур",
    "Поголовье скота",
    "Инвестиции в сельское хозяйство"
  ]
};

export async function selectCategoryDashboard(categoryName, headerElement, API_BASE_URL) {
  const indicators = categoryDashboards[categoryName];
  if (!indicators || indicators.length === 0) return;

  document.querySelectorAll('.cat-header').forEach(el => el.classList.remove('active'));
  if (headerElement) {
    headerElement.classList.add('active');
  }

  const firstIndicator = indicators[0];
  const regionIndEl = document.getElementById('regionIndicatorSelect');
  const mapIndEl = document.getElementById('mapIndicatorSelect');
  
  if (regionIndEl) {
    setSelectValuePrecise(regionIndEl, firstIndicator);
    await onRegionFilterChange(API_BASE_URL);
  }
  if (mapIndEl) {
    setSelectValuePrecise(mapIndEl, firstIndicator);
    await onMapFilterChange(API_BASE_URL);
  }

  for (let i = 1; i <= 6; i++) {
    const selectEl = document.getElementById(`card${i}Indicator`);
    const targetIndicator = indicators[i - 1] || indicators[0];
    
    if (selectEl) {
      setSelectValuePrecise(selectEl, targetIndicator);
      await onCardFilterChange(i, API_BASE_URL, 'bar'); // перенесите customCardChartType или передавайте параметром
    }
  }
}

export async function onRegionFilterChange(API_BASE_URL) {
  const indicator = document.getElementById('regionIndicatorSelect')?.value;
  const year = document.getElementById('regionYearSelect')?.value;
  if (!indicator || !year) return;

  await updateYearChart(API_BASE_URL, indicator, year);

  try {
    const res = await fetch(`${API_BASE_URL}/api/table-data?page=1&limit=50&indicator=${encodeURIComponent(indicator)}`);
    const json = await res.json();
    const filteredRows = (json.data || []).filter(row => String(row.year) === String(year));
    
    const regions = filteredRows.map(row => row.province);
    const values = filteredRows.map(row => row.value);

    renderDynamicSwitchChart(regions, values);
  } catch (err) {
    console.warn('Используем резервные данные', err);
  }

  fetchAIInsights(API_BASE_URL);
}

export async function onCardFilterChange(cardNumber, API_BASE_URL, customCardChartType = 'bar') {
  const indicator = document.getElementById(`card${cardNumber}Indicator`)?.value;
  const year = document.getElementById(`card${cardNumber}Year`)?.value;
  if (!indicator || !year) return;

  try {
    let chartId;
    switch (cardNumber) {
      case 1: chartId = 'chartTypeBar'; await updateBarChart(API_BASE_URL, indicator, year); break;
      case 2: chartId = 'chartTypeLine'; await updateLineChart(API_BASE_URL, indicator, year); break;
      case 3: chartId = 'chartTypePie'; await updatePieChart(API_BASE_URL, indicator, year); break;
      case 4: chartId = 'chartTypeHBar'; await updateHBarChart(API_BASE_URL, indicator, year); break;
      case 5: chartId = 'barAnimationChart'; await updateStackedAreaChart(API_BASE_URL, indicator, year); break;
      case 6: {
        chartId = 'chartTypeCustom';
        await updateCustomChart(API_BASE_URL, indicator, year, customCardChartType);
        break;
      }
    }
    const activeCategory = document.querySelector('.cat-header.active .cat-text')?.textContent?.trim();
    if (!window.activeAnalyzerDataset && chartId && document.getElementById(chartId)?.offsetParent) {
      updateChartAnalysis(chartId, API_BASE_URL, indicator, activeCategory || 'Общие данные', year);
    }
  } catch (err) {
    console.error(`Ошибка при обновлении карточки ${cardNumber}:`, err);
  }
}

export async function onMapFilterChange(API_BASE_URL) {
  const indicator = document.getElementById('mapIndicatorSelect')?.value;
  const year = document.getElementById('mapYearSelect')?.value;
  if (!indicator || !year) return;

  try {
    await initKazakhstanMap(API_BASE_URL, indicator, year);
  } catch (err) {
    console.error('Ошибка при загрузке интерактивной карты Казахстана:', err);
  }
}

export async function onSummaryFilterChange(API_BASE_URL) {
  const indicator = document.getElementById('summaryIndicatorSelect')?.value;
  if (!indicator) return;

  await updateSummaryChart(API_BASE_URL, indicator);
}

export async function switchSubSection(subDataset, el, apiBaseUrl) {
<<<<<<< HEAD
  await openSidebarDatasetPage(subDataset, el, apiBaseUrl);
=======
  const finishLoading = startAppLoading('Загружаем данные раздела…');
  try {
    await transitionAppPage(() => openSidebarDatasetPage(subDataset, el, apiBaseUrl));
  } finally {
    finishLoading();
  }
>>>>>>> dc8732dbe208308ef095b862befeb070e1b443be
}
