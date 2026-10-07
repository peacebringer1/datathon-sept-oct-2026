import { initApp } from './src/components/appInit.js';
import {
  selectCategoryDashboard,
  switchSubSection,
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
const analyzerPort = new URLSearchParams(window.location.search).get('analyzerPort');
window.DATA_ANALYZER_URL = analyzerPort ? `http://127.0.0.1:${analyzerPort}` : '';
window.API_BASE_URL = API_BASE_URL;

async function refreshClaudeApiKeyStatus() {
  const status = document.getElementById('claudeApiKeyStatus');
  if (!status) return;

  try {
    const response = await fetch(`${API_BASE_URL}/api/settings/claude-key`);
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

async function updateClaudeApiKey(method, apiKey) {
  const status = document.getElementById('claudeApiKeyStatus');
  const saveButton = document.getElementById('saveClaudeApiKeyBtn');
  const clearButton = document.getElementById('clearClaudeApiKeyBtn');
  if (saveButton) saveButton.disabled = true;
  if (clearButton) clearButton.disabled = true;

  try {
    if (method === 'POST') {
      if (!window.appSettings?.saveClaudeApiKey) {
        throw new Error('Безопасное хранилище приложения недоступно. Перезапустите приложение.');
      }
      await window.appSettings.saveClaudeApiKey(apiKey);
    }

    const response = await fetch(`${API_BASE_URL}/api/settings/claude-key`, {
      method,
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
      body: method === 'POST' ? JSON.stringify({ api_key: apiKey }) : undefined
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Не удалось обновить настройки ИИ.');

    if (method === 'DELETE') {
      if (!window.appSettings?.clearClaudeApiKey) {
        throw new Error('Ключ удалён из текущего сеанса, но безопасное хранилище недоступно.');
      }
      await window.appSettings.clearClaudeApiKey();
    }

    if (status) {
      status.textContent = method === 'POST'
        ? 'Ключ Claude сохранён. Его действительность проверится при первом запросе.'
        : 'Сохранённый ключ удалён.';
      status.dataset.state = 'success';
    }
    const input = document.getElementById('claudeApiKeyInput');
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
window.switchSubSection = (subDataset, el) => switchSubSection(subDataset, el, API_BASE_URL);
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

const dashboardCallbacks = {
  onRegionFilterChange: () => onRegionFilterChange(API_BASE_URL),
  onMapFilterChange: () => onMapFilterChange(API_BASE_URL),
  onSummaryFilterChange: () => onSummaryFilterChange(API_BASE_URL)
};
window.refreshDemographyCharts = async () => {
  await initApp(API_BASE_URL, dashboardCallbacks);
  await Promise.all([1, 2, 3, 4].map(card => onCardFilterChange(card, API_BASE_URL)));
};

let analyzerDatasetSync = Promise.resolve(true);
let analyzerDatasetSyncQueue = Promise.resolve(true);
let analyzerDatasetSyncRevision = 0;
window.waitForAnalyzerDatasetSync = () => analyzerDatasetSync;
window.addEventListener('message', (event) => {
  const frame = document.getElementById('dataAnalyzerFrame');
  if (!frame || event.source !== frame.contentWindow || !window.DATA_ANALYZER_URL) return;
  if (event.origin !== new URL(window.DATA_ANALYZER_URL).origin) return;
  if (event.data?.type !== 'da-selected-dataset') return;

  const datasetId = event.data.datasetId;
  if (datasetId !== null && (typeof datasetId !== 'string' || !/^[a-f0-9]{8}$/i.test(datasetId))) return;
  const revision = ++analyzerDatasetSyncRevision;

  analyzerDatasetSync = analyzerDatasetSyncQueue.then(async () => {
    const status = document.getElementById('activeDatasetStatus');
    if (status) {
      status.hidden = false;
      status.dataset.state = 'loading';
      status.textContent = 'Загружаю выбранный датасет для графиков…';
    }

    try {
      if (datasetId === null) {
        const response = await fetch(`${API_BASE_URL}/api/active-dataset`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Не удалось отключить выбранный датасет.');
        if (revision !== analyzerDatasetSyncRevision) return false;
        window.activeAnalyzerDataset = false;
        window.activeAnalyzerDatasetMode = null;
        if (status) status.hidden = true;
        frame.contentWindow.postMessage({ type: 'dashboard-dataset-sync', state: 'empty' }, '*');
        return true;
      }

      const datasetResponse = await fetch(`${window.DATA_ANALYZER_URL}/api/datasets/${datasetId}/dashboard-data`);
      const dataset = await datasetResponse.json();
      if (!datasetResponse.ok) throw new Error(dataset.detail || 'Не удалось прочитать выбранный датасет.');
      if (revision !== analyzerDatasetSyncRevision) return false;

      const response = await fetch(`${API_BASE_URL}/api/active-dataset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dataset)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Не удалось подключить датасет к графикам.');
      if (revision !== analyzerDatasetSyncRevision) return false;

      window.activeAnalyzerDataset = true;
      window.activeAnalyzerDatasetMode = result.mode;
      if (status) {
        status.hidden = false;
        status.dataset.state = 'success';
        status.textContent = `Графики используют датасет «${result.name}» (${result.rows.toLocaleString('ru-RU')} строк).`;
      }
      frame.contentWindow.postMessage({
        type: 'dashboard-dataset-sync',
        state: 'success',
        name: result.name
      }, '*');
      return true;
    } catch (error) {
      if (revision !== analyzerDatasetSyncRevision) return false;
      window.activeAnalyzerDataset = false;
      window.activeAnalyzerDatasetMode = null;
      if (status) {
        status.hidden = false;
        status.dataset.state = 'error';
        status.textContent = `Датасет не подключён к графикам: ${error.message}`;
      }
      frame.contentWindow.postMessage({
        type: 'dashboard-dataset-sync',
        state: 'error',
        message: error.message
      }, '*');
      return false;
    }
  });
  analyzerDatasetSyncQueue = analyzerDatasetSync;
});

// Инициализация при загрузке DOM
document.addEventListener('DOMContentLoaded', () => {
  initDetailedViewClose();
  initSidebarSearch();
  initThemeToggle();
  initGlobalResizeListener();

  const settingsBtn = document.getElementById('settingsToggleBtn');
  const settingsMenu = document.getElementById('settingsDropdown');
  const claudeApiKeyForm = document.getElementById('claudeApiKeyForm');
  const clearClaudeApiKeyBtn = document.getElementById('clearClaudeApiKeyBtn');

  if (settingsBtn && settingsMenu) {
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = settingsMenu.style.display === 'block';
      settingsMenu.style.display = isOpen ? 'none' : 'block';
      if (!isOpen) refreshClaudeApiKeyStatus();
    });

    document.addEventListener('click', (e) => {
      if (!settingsMenu.contains(e.target) && !settingsBtn.contains(e.target)) {
        settingsMenu.style.display = 'none';
      }
    });
  }

  if (claudeApiKeyForm) {
    claudeApiKeyForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = document.getElementById('claudeApiKeyInput');
      if (!input?.value.trim()) {
        const status = document.getElementById('claudeApiKeyStatus');
        if (status) {
          status.textContent = 'Вставьте API-ключ Claude из Anthropic Console.';
          status.dataset.state = 'error';
        }
        return;
      }
      updateClaudeApiKey('POST', input.value);
    });
  }

  if (clearClaudeApiKeyBtn) {
    clearClaudeApiKeyBtn.addEventListener('click', () => updateClaudeApiKey('DELETE'));
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
  ...dashboardCallbacks
});

initAIChat(API_BASE_URL);

// Корректный вызов сводных графиков при старте
const summaryIndEl = document.getElementById('summaryIndicatorSelect');
if (summaryIndEl && summaryIndEl.value) {
  await updateSummaryChart(API_BASE_URL, summaryIndEl.value);
  await updateMultiSummaryChart(API_BASE_URL);
}

// Функция управления каруселью аналитики
let wishlistScrollPosition = 0;

function updateWishlistNavigation() {
  const track = document.getElementById('wishlistTrack');
  if (!track) return;
  const container = track.parentElement;
  const buttons = document.querySelectorAll('.wishlist-nav-btn');
  const maxScroll = Math.max(0, track.scrollWidth - container.clientWidth);
  wishlistScrollPosition = Math.min(wishlistScrollPosition, maxScroll);
  buttons[0]?.toggleAttribute('disabled', wishlistScrollPosition <= 0);
  buttons[1]?.toggleAttribute('disabled', wishlistScrollPosition >= maxScroll - 1);
  track.style.transform = `translateX(-${wishlistScrollPosition}px)`;
}

window.scrollWishlist = function(direction) {
  const track = document.getElementById('wishlistTrack');
  const firstCard = track?.querySelector('.wishlist-card');
  if (!track || !firstCard) return;
  const gap = Number.parseFloat(getComputedStyle(track).columnGap) || 0;
  const step = firstCard.getBoundingClientRect().width + gap;
  const maxScroll = Math.max(0, track.scrollWidth - track.parentElement.clientWidth);
  wishlistScrollPosition = Math.max(0, Math.min(
    maxScroll,
    wishlistScrollPosition + (direction === 'right' ? step : -step)
  ));
  updateWishlistNavigation();
};

window.addEventListener('resize', updateWishlistNavigation);
requestAnimationFrame(updateWishlistNavigation);
