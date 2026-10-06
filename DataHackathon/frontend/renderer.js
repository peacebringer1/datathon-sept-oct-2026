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

const apiPort = new URLSearchParams(window.location.search).get('apiPort') || '5000';
const API_BASE_URL = `http://127.0.0.1:${apiPort}`;
window.API_BASE_URL = API_BASE_URL;

async function refreshGeminiApiKeyStatus() {
  const status = document.getElementById('geminiApiKeyStatus');
  if (!status) return;

  try {
    const response = await fetch(`${API_BASE_URL}/api/settings/gemini-key`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Не удалось проверить настройки ИИ.');
    status.textContent = result.configured
      ? 'Ключ подключён. Его действительность проверится при первом запросе.'
      : 'Ключ не подключён.';
    status.dataset.state = result.configured ? 'success' : 'info';
  } catch (error) {
    status.textContent = `Не удалось проверить backend: ${error.message}`;
    status.dataset.state = 'error';
  }
}

async function updateGeminiApiKey(method, apiKey) {
  const status = document.getElementById('geminiApiKeyStatus');
  const saveButton = document.getElementById('saveGeminiApiKeyBtn');
  const clearButton = document.getElementById('clearGeminiApiKeyBtn');
  if (saveButton) saveButton.disabled = true;
  if (clearButton) clearButton.disabled = true;

  try {
    if (method === 'POST') {
      if (!window.appSettings?.saveGeminiApiKey) {
        throw new Error('Безопасное хранилище приложения недоступно. Перезапустите приложение.');
      }
      await window.appSettings.saveGeminiApiKey(apiKey);
    }

    const response = await fetch(`${API_BASE_URL}/api/settings/gemini-key`, {
      method,
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
      body: method === 'POST' ? JSON.stringify({ api_key: apiKey }) : undefined
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Не удалось обновить настройки ИИ.');

    if (method === 'DELETE') {
      if (!window.appSettings?.clearGeminiApiKey) {
        throw new Error('Ключ удалён из текущего сеанса, но безопасное хранилище недоступно.');
      }
      await window.appSettings.clearGeminiApiKey();
    }

    if (status) {
      status.textContent = method === 'POST'
        ? 'Ключ сохранён и подключён. Gemini проверит его при первом запросе.'
        : 'Сохранённый ключ удалён.';
      status.dataset.state = 'success';
    }
    const input = document.getElementById('geminiApiKeyInput');
    if (input) input.value = '';
  } catch (error) {
    if (status) {
      status.textContent = `Ошибка: ${error.message}`;
      status.dataset.state = 'error';
    }
  } finally {
    if (saveButton) saveButton.disabled = false;
    if (clearButton) clearButton.disabled = false;
  }
}

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
  const geminiApiKeyForm = document.getElementById('geminiApiKeyForm');
  const clearGeminiApiKeyBtn = document.getElementById('clearGeminiApiKeyBtn');

  if (settingsBtn && settingsMenu) {
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = settingsMenu.style.display === 'block';
      settingsMenu.style.display = isOpen ? 'none' : 'block';
      if (!isOpen) refreshGeminiApiKeyStatus();
    });

    document.addEventListener('click', (e) => {
      if (!settingsMenu.contains(e.target) && !settingsBtn.contains(e.target)) {
        settingsMenu.style.display = 'none';
      }
    });
  }

  if (geminiApiKeyForm) {
    geminiApiKeyForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = document.getElementById('geminiApiKeyInput');
      if (!input?.value.trim()) {
        const status = document.getElementById('geminiApiKeyStatus');
        if (status) {
          status.textContent = 'Вставьте API-ключ Gemini.';
          status.dataset.state = 'error';
        }
        return;
      }
      updateGeminiApiKey('POST', input.value);
    });
  }

  if (clearGeminiApiKeyBtn) {
    clearGeminiApiKeyBtn.addEventListener('click', () => updateGeminiApiKey('DELETE'));
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

