import { 
  updateYearChart, 
  updateBarChart,
  updateLineChart,
  updatePieChart,
  updateHBarChart,
  updateSummaryChart, 
  initKazakhstanMap, 
  activateMapZoom,
  yearChartInstance,
  lineChartInstance,
  pieChartInstance,
  hBarChartInstance,
  summaryChartInstance,
  kzMapInstance,
  updateStackedAreaChart,
  stackedAreaChartInstance
} from './src/components/chartsMap.js';
import { toggleCategory, initSidebarSearch } from './src/components/sidebar.js';
import { loadTablePage, filterTable, toggleTableVisibility } from './src/components/table.js';
import { fetchAIInsights } from './src/components/insightsTicker.js';
import { renderDynamicSwitchChart } from './src/components/dynamicCharts.js';
import { initAIChat, toggleAIChat, handleChatKeyDown } from './src/components/aiChat.js';
import { fetchAIAnalysisForChart } from './src/components/geminiService.js';

let activeTab = 'year';
const API_BASE_URL = 'http://127.0.0.1:5000';

// Наборы показателей для каждой категории (распределяются по 6 карточкам при клике)
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

async function initApp() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/init-filters`);
    const { indicators, years } = await res.json();

    const optionsHTML = indicators.map(ind => `<option value="${ind}">${ind}</option>`).join('');
    const yearsHTML = years.map(y => `<option value="${y}">${y} год</option>`).join('');

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

    onRegionFilterChange();
    onMapFilterChange();
    onSummaryFilterChange();

    const card5Ind = document.getElementById('card5Indicator')?.value || indicators[0];
    const card5Year = document.getElementById('card5Year')?.value || years[0];
    if (card5Ind && card5Year) {
      await updateStackedAreaChart(API_BASE_URL, card5Ind, card5Year);
    }

    loadTablePage(API_BASE_URL);
    fetchAIInsights(API_BASE_URL);
  } catch (err) {
    console.warn('Ожидание запуска Flask-сервера...', err);
    setTimeout(initApp, 1000);
  }
}

function populateAllSelectors(indicatorsList, yearsList) {
  const optionsHTML = indicatorsList.map(ind => `<option value="${ind}">${ind}</option>`).join('');
  const yearsHTML = yearsList.map(y => `<option value="${y}">${y} год</option>`).join('');

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
    }
    if (yearEl) {
      const currentYear = yearEl.value;
      yearEl.innerHTML = yearsHTML;
      if (currentYear) yearEl.value = currentYear;
    }
  }
}

// Клик по категории: распределяет 6 показателей категории по 6 карточкам дашборда
async function selectCategoryDashboard(categoryName, headerElement) {
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
    await onRegionFilterChange();
  }
  if (mapIndEl) {
    setSelectValuePrecise(mapIndEl, firstIndicator);
    await onMapFilterChange();
  }

  for (let i = 1; i <= 6; i++) {
    const selectEl = document.getElementById(`card${i}Indicator`);
    const targetIndicator = indicators[i - 1] || indicators[0];
    
    if (selectEl) {
      setSelectValuePrecise(selectEl, targetIndicator);
      await onCardFilterChange(i);
    }
  }
}

async function onRegionFilterChange() {
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

async function onCardFilterChange(cardNumber) {
  const indicator = document.getElementById(`card${cardNumber}Indicator`)?.value;
  const year = document.getElementById(`card${cardNumber}Year`)?.value;
  if (!indicator || !year) return;

  try {
    switch (cardNumber) {
      case 1:
        await updateBarChart(API_BASE_URL, indicator, year);
        break;
      case 2:
        await updateLineChart(API_BASE_URL, indicator, year);
        break;
      case 3:
        await updatePieChart(API_BASE_URL, indicator, year);
        break;
      case 4:
        await updateHBarChart(API_BASE_URL, indicator, year);
        break;
      case 5: {
        await updateStackedAreaChart(API_BASE_URL, indicator, year);
        break;
      }
      case 6: {
        const indicatorId = indicator;
        const yearVal = year;
        
        // Рендерим в зависимости от сохраненного типа кастомного графика
        if (customCardChartType === 'line') {
          await updateLineChart(API_BASE_URL, indicatorId, yearVal);
        } else if (customCardChartType === 'pie') {
          await updatePieChart(API_BASE_URL, indicatorId, yearVal);
        } else {
          await updateBarChart(API_BASE_URL, indicatorId, yearVal);
        }
        break;
      }
    }
  } catch (err) {
    console.error(`Ошибка при обновлении карточки ${cardNumber}:`, err);
  }
}

async function onMapFilterChange() {
  const indicator = document.getElementById('mapIndicatorSelect')?.value;
  const year = document.getElementById('mapYearSelect')?.value;
  if (!indicator || !year) return;

  try {
    await initKazakhstanMap(API_BASE_URL, indicator, year);
  } catch (err) {
    console.error('Ошибка при загрузке интерактивной карты Казахстана:', err);
  }
}

async function onSummaryFilterChange() {
  const indicator = document.getElementById('summaryIndicatorSelect')?.value;
  if (!indicator) return;

  await updateSummaryChart(API_BASE_URL, indicator);
}

function switchTab(tab) {
  activeTab = tab;
  const btns = document.querySelectorAll('.tab-btn');
  const yearSection = document.getElementById('yearChartSection');
  const mapSection = document.getElementById('mapChartSection');
  const summaryWrapper = document.getElementById('summaryChartWrapper');

  if (btns.length >= 2) {
    btns[0].classList.toggle('active', tab === 'year');
    btns[1].classList.toggle('active', tab === 'summary');
  }

  const toggleVisibility = (element, show) => {
    if (!element) return;
    if (show) {
      element.classList.remove('hidden');
      element.style.opacity = '0';
      element.style.transform = 'translateY(10px)';
      requestAnimationFrame(() => {
        element.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
        element.style.opacity = '1';
        element.style.transform = 'translateY(0)';
      });
    } else {
      element.classList.add('hidden');
    }
  };

  if (tab === 'year') {
    toggleVisibility(yearSection, true);
    toggleVisibility(mapSection, true);
    toggleVisibility(summaryWrapper, false);
    
    setTimeout(() => {
      if (yearChartInstance) yearChartInstance.resize();
      if (kzMapInstance) kzMapInstance.resize();
    }, 50);
  } else {
    toggleVisibility(yearSection, false);
    toggleVisibility(mapSection, false);
    toggleVisibility(summaryWrapper, true);
    
    setTimeout(() => {
      if (summaryChartInstance) summaryChartInstance.resize();
    }, 50);
  }
}

// Утилита для точного выбора значения в селекторах
function setSelectValuePrecise(selectElement, targetValue) {
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

// Глобальный инстанс детального графика
let detailedEChartInstance = null;

// Функция открытия детального просмотра с ИИ-аналитикой
window.openDetailedAnalytics = async function(chartTitle, analyticsText, sourceChartElementId) {
  const mainDashboard = document.getElementById('mainDashboardContent');
  if (mainDashboard) mainDashboard.style.display = 'none';

  const detailedSection = document.getElementById('detailedViewSection');
  if (detailedSection) detailedSection.classList.add('active');

  const titleEl = document.getElementById('detailedChartTitle');
  if (titleEl) titleEl.innerText = chartTitle;

  const descEl = document.getElementById('aiAnalyticsDescription');
  if (descEl) {
    descEl.innerText = analyticsText || "⏳ Загрузка анализа...";
  }

  setTimeout(() => {
    renderDetailedChart(sourceChartElementId);
  }, 50);
};

// Функция отрисовки графика в детальном режиме
function renderDetailedChart(sourceChartId) {
  const container = document.getElementById('realDetailedChart');
  if (!container) return;

  const sourceElement = document.getElementById(sourceChartId);
  if (sourceElement && window.echarts) {
    const sourceChart = echarts.getInstanceByDom(sourceElement);
    if (sourceChart) {
      const option = sourceChart.getOption();
      
      if (detailedEChartInstance) {
        detailedEChartInstance.dispose();
      }

      detailedEChartInstance = echarts.init(container);
      detailedEChartInstance.setOption(option);
      
      setTimeout(() => {
        detailedEChartInstance.resize();
      }, 100);
      return;
    }
  }
}

// Функция вызова аналитики из карточки с запросом к Gemini
window.openAnalyticsFromCard = async function(buttonElement) {
  const card = buttonElement.closest('.sub-chart-card');
  if (!card) return;

  const select = card.querySelector('select');
  const indicatorName = select ? select.options[select.selectedIndex].text : 'График данных';
  
  const activeCategoryEl = document.querySelector('.cat-header.active .cat-text');
  const categoryName = activeCategoryEl ? activeCategoryEl.innerText : 'Общие данные';

  const chartDiv = card.querySelector('[id^="chartType"], [id$="Chart"]');
  const chartId = chartDiv ? chartDiv.id : null;

  window.openDetailedAnalytics(
    indicatorName,
    "⏳ Генерация ИИ-аналитики с помощью Gemini...",
    chartId
  );

  const realAnalysisText = await fetchAIAnalysisForChart(indicatorName, categoryName);

  const descEl = document.getElementById('aiAnalyticsDescription');
  if (descEl) {
    descEl.innerText = realAnalysisText;
  }
};

// Переменная для хранения типа кастомного графика
let customCardChartType = 'bar';

// Управление модальным окном добавления кастомного графика
window.openAddChartModal = function() {
  const modal = document.getElementById('addChartModal');
  const indSelect = document.getElementById('modalIndicatorSelect');
  const yearSelect = document.getElementById('modalYearSelect');
  
  const sourceIndicator = document.getElementById('card1Indicator');
  const sourceYear = document.getElementById('card1Year');
  
  if (sourceIndicator && sourceYear) {
    indSelect.innerHTML = sourceIndicator.innerHTML;
    yearSelect.innerHTML = sourceYear.innerHTML;
  }
  
  modal.style.display = 'flex';
};

window.closeAddChartModal = function() {
  document.getElementById('addChartModal').style.display = 'none';
};

window.saveCustomCard = async function() {
  const selectedInd = document.getElementById('modalIndicatorSelect').value;
  const selectedYear = document.getElementById('modalYearSelect').value;
  const selectedType = document.getElementById('modalChartType').value; // считываем выбранный тип

  customCardChartType = selectedType; // сохраняем

  document.getElementById('customCardPrompt').style.display = 'none';
  document.getElementById('customCardHeader').style.display = 'flex';
  
  const customCard = document.getElementById('chartTypeCustom');
  customCard.style.display = 'block';

  document.getElementById('card6Indicator').value = selectedInd;
  document.getElementById('card6Year').value = selectedYear;

  window.closeAddChartModal();

  // Обновляем 6-ю карточку (рендерим график через case 6)
  await onCardFilterChange(6);
};

window.resetCustomCard = function() {
  document.getElementById('customCardPrompt').style.display = 'flex';
  document.getElementById('customCardHeader').style.display = 'none';
  document.getElementById('chartTypeCustom').style.display = 'none';
  document.getElementById('chartTypeCustom').innerHTML = '';
};

// Инициализация при загрузке DOM
document.addEventListener('DOMContentLoaded', () => {
  const backBtn = document.getElementById('backToDashBtn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      const detailedSection = document.getElementById('detailedViewSection');
      if (detailedSection) detailedSection.classList.remove('active');

      const mainDashboard = document.getElementById('mainDashboardContent');
      if (mainDashboard) mainDashboard.style.display = 'block';

      if (detailedEChartInstance) {
        detailedEChartInstance.dispose();
        detailedEChartInstance = null;
      }
    });
  }

  initSidebarSearch();

  const settingsBtn = document.getElementById('settingsToggleBtn');
  const settingsMenu = document.getElementById('settingsDropdown');
  
  if (settingsBtn && settingsMenu) {
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      settingsMenu.style.display = settingsMenu.style.display === 'block' ? 'none' : 'block';
    });
    
    document.addEventListener('click', (e) => {
      if (!settingsMenu.contains(e.target) && !settingsBtn.contains(e.target)) {
        settingsMenu.style.display = 'none';
      }
    });
  }

  const sidebar = document.getElementById('categorySidebar');
  const mainContent = document.querySelector('.main-content-area');

  if (sidebar) {
    sidebar.addEventListener('click', (e) => {
      if (e.target.closest('.sidebar-settings-footer') || e.target.closest('.sidebar-search-box')) {
        return;
      }
      sidebar.classList.toggle('pinned');
      e.stopPropagation();
    });
  }

  if (mainContent) {
    mainContent.addEventListener('click', () => {
      if (sidebar) {
        sidebar.classList.remove('pinned');
      }
    });
  }
});

// Экспорт функций в глобальную область
window.toggleAIChat = toggleAIChat;
window.handleChatKeyDown = handleChatKeyDown;
window.toggleCategory = toggleCategory;
window.selectCategoryDashboard = selectCategoryDashboard;
window.switchTab = switchTab;
window.filterTable = () => filterTable(API_BASE_URL);
window.onRegionFilterChange = onRegionFilterChange;
window.onMapFilterChange = onMapFilterChange;
window.onSummaryFilterChange = onSummaryFilterChange;
window.onCardFilterChange = onCardFilterChange;
window.toggleTableVisibility = toggleTableVisibility;
window.activateMapZoom = activateMapZoom;
window.openAddChartModal = openAddChartModal;
window.closeAddChartModal = closeAddChartModal;
window.saveCustomCard = saveCustomCard;
window.resetCustomCard = resetCustomCard;
window.openDetailedAnalytics = openDetailedAnalytics;
window.openAnalyticsFromCard = openAnalyticsFromCard;

window.addEventListener('resize', () => {
  if (yearChartInstance) yearChartInstance.resize();
  if (lineChartInstance) lineChartInstance.resize();
  if (pieChartInstance) pieChartInstance.resize();
  if (hBarChartInstance) hBarChartInstance.resize();
  if (stackedAreaChartInstance) stackedAreaChartInstance.resize();
  if (summaryChartInstance) summaryChartInstance.resize();
  if (kzMapInstance) kzMapInstance.resize();
  if (detailedEChartInstance) detailedEChartInstance.resize();
});

const themeToggleBtn = document.getElementById('themeToggleBtn');
if (localStorage.getItem('theme') === 'dark') {
  document.body.classList.add('dark-theme');
  if (themeToggleBtn) themeToggleBtn.textContent = '☀️';
}

if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', async (event) => {
    const rect = themeToggleBtn.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    const isDark = document.body.classList.contains('dark-theme');
    const nextDark = !isDark;

    if (document.startViewTransition) {
      const transition = document.startViewTransition(() => {
        document.body.classList.toggle('dark-theme', nextDark);
      });

      await transition.ready;
      const maxRadius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y)
      );

      document.documentElement.animate(
        [
          { clipPath: `circle(0px at ${x}px ${y}px)` },
          { clipPath: `circle(${maxRadius}px at ${x}px ${y}px)` }
        ],
        {
          duration: 1200,
          easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
          pseudoElement: '::view-transition-new(root)'
        }
      );
    } else {
      document.body.classList.toggle('dark-theme', nextDark);
    }

    themeToggleBtn.textContent = nextDark ? '☀️' : '🌙';
    localStorage.setItem('theme', nextDark ? 'dark' : 'light');
    window.dispatchEvent(new Event('resize'));
  });
}

// Запуск приложения
initApp();
initAIChat();