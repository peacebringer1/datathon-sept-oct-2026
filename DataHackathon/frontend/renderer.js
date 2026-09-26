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
import { toggleCategory, selectIndicator as sidebarSelectIndicator } from './src/components/sidebar.js';
import { loadTablePage, filterTable, toggleTableVisibility } from './src/components/table.js';
import { fetchAIInsights } from './src/components/insightsTicker.js';
import { renderDynamicSwitchChart } from './src/components/dynamicCharts.js';
import { initAIChat, toggleAIChat, handleChatKeyDown } from './src/components/aiChat.js';

let activeTab = 'year';

const API_BASE_URL = 'http://127.0.0.1:5000';

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

    // Инициализация 5-й карточки градиентным стековым графиком при старте
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

    // Старый анимационный график полностью исключен
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
        const res = await fetch(`${API_BASE_URL}/api/table-data?page=1&limit=50&indicator=${encodeURIComponent(indicator)}`);
        const json = await res.json();
        const filteredRows = (json.data || []).filter(row => String(row.year) === String(year));
        renderDynamicSwitchChart(filteredRows.map(r => r.province), filteredRows.map(r => r.value));
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

window.toggleAIChat = toggleAIChat;
window.handleChatKeyDown = handleChatKeyDown;
window.toggleCategory = toggleCategory;
window.selectIndicator = (name) => {
  sidebarSelectIndicator(name, event, onRegionFilterChange);
};
window.switchTab = switchTab;
window.filterTable = () => filterTable(API_BASE_URL);
window.onRegionFilterChange = onRegionFilterChange;
window.onMapFilterChange = onMapFilterChange;
window.onSummaryFilterChange = onSummaryFilterChange;
window.onCardFilterChange = onCardFilterChange;
window.toggleTableVisibility = toggleTableVisibility;
window.activateMapZoom = activateMapZoom;

window.addEventListener('resize', () => {
  if (yearChartInstance) yearChartInstance.resize();
  if (lineChartInstance) lineChartInstance.resize();
  if (pieChartInstance) pieChartInstance.resize();
  if (hBarChartInstance) hBarChartInstance.resize();
  if (stackedAreaChartInstance) stackedAreaChartInstance.resize();
  if (summaryChartInstance) summaryChartInstance.resize();
  if (kzMapInstance) kzMapInstance.resize();
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

initApp();
initAIChat();