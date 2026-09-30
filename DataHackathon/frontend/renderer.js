import { initApp } from './src/components/appInit.js';
import {
  selectCategoryDashboard,
  onRegionFilterChange,
  onCardFilterChange,
  onMapFilterChange,
  onSummaryFilterChange
} from './src/components/dashboardController.js';
import { toggleCategory, initSidebarSearch } from './src/components/sidebar.js';
import { filterTable, toggleTableVisibility } from './src/components/table.js';
import { initAIChat, toggleAIChat } from './src/components/aiChat.js';
import {
  switchTab,
  openAddChartModal,
  closeAddChartModal,
  saveCustomCard,
  resetCustomCard,
  initThemeToggle,
  initGlobalResizeListener
} from './src/components/uiInteractions.js';
import { openDetailedAnalytics, openAnalyticsFromCard, initDetailedViewClose } from './src/components/detailedView.js';
import { updateSummaryChart, updateMultiSummaryChart } from './src/components/chartsMap.js';

const API_BASE_URL = 'http://127.0.0.1:5000';

// Связываем глобальные обработчики для HTML-атрибутов (onclick и т.д.)
window.toggleAIChat = toggleAIChat;
window.toggleCategory = toggleCategory;
window.selectCategoryDashboard = (cat, el) => selectCategoryDashboard(cat, el, API_BASE_URL);
window.switchTab = (tab) => switchTab(tab, API_BASE_URL);
window.filterTable = () => filterTable(API_BASE_URL);
window.onRegionFilterChange = () => onRegionFilterChange(API_BASE_URL);
window.onMapFilterChange = () => onMapFilterChange(API_BASE_URL);
window.onSummaryFilterChange = () => onSummaryFilterChange(API_BASE_URL);
window.onCardFilterChange = (num) => onCardFilterChange(num, API_BASE_URL);
window.toggleTableVisibility = toggleTableVisibility;
window.openAddChartModal = openAddChartModal;
window.closeAddChartModal = closeAddChartModal;
window.saveCustomCard = () => saveCustomCard((num, type) => onCardFilterChange(num, API_BASE_URL, type));
window.resetCustomCard = resetCustomCard;
window.openDetailedAnalytics = openDetailedAnalytics;
window.openAnalyticsFromCard = (button) => openAnalyticsFromCard(button, API_BASE_URL);

// Инициализация при загрузке DOM
document.addEventListener('DOMContentLoaded', () => {
  initDetailedViewClose();
  initSidebarSearch();
  initThemeToggle();
  initGlobalResizeListener();

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
      if (sidebar) sidebar.classList.remove('pinned');
    });
  }
});

// Запуск старта приложения
initApp(API_BASE_URL, {
  onRegionFilterChange: () => onRegionFilterChange(API_BASE_URL),
  onMapFilterChange: () => onMapFilterChange(API_BASE_URL),
  onSummaryFilterChange: () => onSummaryFilterChange(API_BASE_URL)
});

initAIChat(API_BASE_URL);

// Корректный вызов сводных графиков при старте
const summaryIndEl = document.getElementById('summaryIndicatorSelect');
if (summaryIndEl && summaryIndEl.value) {
  await updateSummaryChart(API_BASE_URL, summaryIndEl.value);
  await updateMultiSummaryChart(API_BASE_URL);
}


