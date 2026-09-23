let yearChartInstance = null;
let summaryChartInstance = null;
let kzMapInstance = null;
let cachedKZJson = null;

let activeTab = 'year';
let currentPage = 1;

// СЮДА НИ В КОЕМ СЛУЧАЕ НЕ СОВАТЬ КЛЮЧ ОТ API - КОНФИДЕНЦИАЛЬНАЯ ИНФОРМАЦИЯ,
// КОТОРАЯ МОЖЕТ СТАТЬ ПУБЛИЧНОЙ В СЛУЧАЕ ОТПРАВКИ ИЗМЕНЕНИЙ В РЕПОЗИТОРИЙ.
const GEMINI_API_KEY = '!!!!!!!!!!!!!!!!!!';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
let chatHistory = [];

const API_BASE_URL = 'http://127.0.0.1:5000';

// Словарь соответствия названий из data.csv к названиям на карте GeoJSON
const regionNameMapping = {
  "Акмолинская область": "Ақмола облысы",
  "Актюбинская область": "Ақтөбе облысы",
  "Алматинская область": "Алматы облысы",
  "Атырауская область": "Атырау облысы",
  "Восточно-Казахстанская область": "Шығыс Қазақстан облысы",
  "Жамбылская область": "Жамбыл облысы",
  "Западно-Казахстанская область": "Батыс Қазақстан облысы",
  "Карагандинская область": "Қарағанды облысы",
  "Костанайская область": "Қостанай облысы",
  "Кызылординская область": "Қызылорда облысы",
  "Мангистауская область": "Маңғыстау облысы",
  "Павлодарская область": "Павлодар облысы",
  "Северо-Казахстанская область": "Солтүстік Қазақстан облысы",
  "Южно-Казахстанская область": "Түркістан облысы",
  "Туркестанская область": "Түркістан облысы",
  "Область Абай": "Абай облысы",
  "Область Жетысу": "Жетісу облысы",
  "Область Улытау": "Ұлытау облысы",
  "г. Алматы": "Алматы",
  "г. Астана": "Астана",
  "г. Шымкент": "Шымкент"
};

// Инициализация при старте приложения
async function initApp() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/init-filters`);
    const { indicators, years } = await res.json();

    const indicatorSelect = document.getElementById('indicatorSelect');
    if (indicatorSelect) {
      indicatorSelect.innerHTML = indicators.map(ind => `<option value="${ind}">${ind}</option>`).join('');
    }

    const yearSelect = document.getElementById('yearSelect');
    if (yearSelect) {
      yearSelect.innerHTML = years.map(y => `<option value="${y}">${y} год</option>`).join('');
    }

    onFilterChange();
  } catch (err) {
    console.warn('Ожидание запуска Flask-сервера...', err);
    setTimeout(initApp, 1000);
  }
}

// Пересчет данных при изменении фильтров
async function onFilterChange() {
  currentPage = 1;
  const indicatorEl = document.getElementById('indicatorSelect');
  const yearEl = document.getElementById('yearSelect');
  
  if (!indicatorEl || !yearEl) return;

  const indicator = indicatorEl.value;
  const year = yearEl.value;

  if (!indicator) return;

  if (activeTab === 'year') {
    await updateYearChart(indicator, year);
    await initKazakhstanMap(indicator, year);
  } else {
    await updateSummaryChart(indicator);
  }
  
  loadTablePage();
  fetchAIInsights();
}

// Отрисовка столбчатого графика по годам и регионам
async function updateYearChart(indicator, year) {
  if (!indicator || !year) return;

  try {
    const res = await fetch(`${API_BASE_URL}/api/chart-year?indicator=${encodeURIComponent(indicator)}&year=${year}`);
    const { labels, values } = await res.json();

    const canvas = document.getElementById('regionChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    if (yearChartInstance) yearChartInstance.destroy();

    yearChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: `${indicator} (${year} год)`,
          data: values,
          backgroundColor: 'rgba(54, 162, 235, 0.75)',
          borderColor: 'rgba(54, 162, 235, 1)',
          borderWidth: 1.5,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true } }
      }
    });
  } catch (e) {
    console.error('Ошибка загрузки данных по годам:', e);
  }
}

// Отрисовка итогового графика (за все года)
async function updateSummaryChart(indicator) {
  if (!indicator) return;

  try {
    const res = await fetch(`${API_BASE_URL}/api/chart-summary?indicator=${encodeURIComponent(indicator)}`);
    const { labels, values } = await res.json();

    const canvas = document.getElementById('summaryChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (summaryChartInstance) summaryChartInstance.destroy();

    summaryChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: `Итоговый показатель: ${indicator}`,
          data: values,
          backgroundColor: 'rgba(75, 192, 192, 0.75)',
          borderColor: 'rgba(75, 192, 192, 1)',
          borderWidth: 1.5,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true } }
      }
    });
  } catch (e) {
    console.error('Ошибка загрузки суммарных данных:', e);
  }
}

// Отрисовка карты Казахстана (ECharts)
async function initKazakhstanMap(indicator, year) {
  const chartDom = document.getElementById('kazakhstanMapChart');
  if (!chartDom) return;

  if (!kzMapInstance) {
    kzMapInstance = echarts.init(chartDom);
  }

  kzMapInstance.showLoading();

  try {
    if (!cachedKZJson) {
      const geoRes = await fetch('https://raw.githubusercontent.com/artemnovichkov/KazakhstanMapExample/main/KazakhstanMapExample/kazakhstan.geojson');
      if (!geoRes.ok) throw new Error(`HTTP error! status: ${geoRes.status}`);
      
      cachedKZJson = await geoRes.json();
      echarts.registerMap('KZ', cachedKZJson);
    }

    const res = await fetch(`${API_BASE_URL}/api/chart-year?indicator=${encodeURIComponent(indicator)}&year=${year}`);
    const chartData = await res.json();

    const formattedData = chartData.labels.map((label, index) => {
      const mappedName = regionNameMapping[label] || label;
      return {
        name: mappedName,
        value: chartData.values[index]
      };
    });

    const values = chartData.values;
    const minVal = values.length ? Math.min(...values) : 0;
    const maxVal = values.length ? Math.max(...values) : 100;

    const option = {
      title: {
        text: `Географическое распределение: ${indicator} (${year})`,
        left: 'center',
        textStyle: { fontSize: 14, color: '#1e293b' }
      },
      tooltip: {
        trigger: 'item',
        formatter: function(params) {
          const val = params.value !== undefined && !isNaN(params.value) ? params.value.toLocaleString('ru-RU') : 'Нет данных';
          return `<b>${params.name}</b><br/>Значение: <b>${val}</b>`;
        }
      },
      visualMap: {
        left: 'right',
        min: minVal,
        max: maxVal,
        inRange: {
          color: ['#e0f3f8', '#abd9e9', '#74add1', '#4575b4', '#313695']
        },
        text: ['Макс', 'Мин'],
        calculable: true
      },
      series: [{
        type: 'map',
        map: 'KZ',
        roam: true,
        center: [67.0, 48.0],
        zoom: 4.5,
        scaleLimit: { min: 1, max: 10 },
        data: formattedData,
        label: {
          show: true,
          fontSize: 8,
          color: '#333'
        },
        emphasis: {
          itemStyle: { areaColor: '#f46d43' },
          label: { show: true, color: '#000', fontWeight: 'bold' }
        }
      }]
    };

    kzMapInstance.hideLoading();
    kzMapInstance.setOption(option, true);
  } catch (error) {
    console.error('Ошибка загрузки карты Казахстана:', error);
    kzMapInstance.hideLoading();
  }
}

// Управление вкладками
function switchTab(tab) {
  activeTab = tab;
  const btns = document.querySelectorAll('.tab-btn');
  const yearBlock = document.getElementById('yearSelectorBlock2');
  const yearWrapper = document.getElementById('yearChartWrapper');
  const mapWrapper = document.getElementById('mapChartWrapper');
  const summaryWrapper = document.getElementById('summaryChartWrapper');

  if (btns.length >= 2) {
    btns[0].classList.toggle('active', tab === 'year');
    btns[1].classList.toggle('active', tab === 'summary');
  }

  if (tab === 'year') {
    if (yearBlock) yearBlock.classList.remove('hidden');
    if (yearWrapper) yearWrapper.classList.remove('hidden');
    if (mapWrapper) mapWrapper.classList.remove('hidden');
    if (summaryWrapper) summaryWrapper.classList.add('hidden');
    if (yearChartInstance) yearChartInstance.resize();
    if (kzMapInstance) kzMapInstance.resize();
  } else {
    if (yearBlock) yearBlock.classList.add('hidden');
    if (yearWrapper) yearWrapper.classList.add('hidden');
    if (mapWrapper) mapWrapper.classList.add('hidden');
    if (summaryWrapper) summaryWrapper.classList.remove('hidden');
    if (summaryChartInstance) summaryChartInstance.resize();
  }

  onFilterChange();
}

// Загрузка таблицы
async function loadTablePage() {
  const indicatorEl = document.getElementById('indicatorSelect');
  const searchEl = document.getElementById('searchInput');
  const counterEl = document.getElementById('counter');
  const head = document.getElementById('tableHead');
  const body = document.getElementById('tableBody');

  if (!indicatorEl || !head || !body) return;

  const indicator = indicatorEl.value;
  const search = searchEl ? searchEl.value : '';

  try {
    const res = await fetch(`${API_BASE_URL}/api/table-data?page=${currentPage}&limit=50&indicator=${encodeURIComponent(indicator)}&search=${encodeURIComponent(search)}`);
    const { total, columns, data } = await res.json();

    if (counterEl) {
      counterEl.innerText = `Записей в базе: ${total.toLocaleString('ru-RU')}`;
    }

    head.innerHTML = `<tr>${columns.map(c => `<th>${c}</th>`).join('')}</tr>`;
    body.innerHTML = data.map(row => `
      <tr>
        <td>${row.indicator}</td>
        <td>${row.year}</td>
        <td>${row.province}</td>
        <td>${row.value !== undefined && row.value !== null ? row.value.toLocaleString('ru-RU') : 0}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Ошибка загрузки таблицы:', err);
  }
}

function filterTable() {
  currentPage = 1;
  loadTablePage();
}

// ИИ Инсайты и тикер
async function fetchAIInsights() {
  const indicatorEl = document.getElementById('indicatorSelect');
  const track = document.getElementById('tickerTrack');
  if (!indicatorEl || !track) return;

  const indicator = indicatorEl.value;

  try {
    const res = await fetch(`${API_BASE_URL}/api/ai-insights?indicator=${encodeURIComponent(indicator)}`);
    const { insights } = await res.json();

    if (!insights || insights.length === 0) {
      track.innerHTML = '<div class="ticker-item">Аномалий не обнаружено</div>';
      return;
    }

    const fullList = [...insights, ...insights];
    track.innerHTML = fullList.map(item => `
      <div class="ticker-item ${item.type}">
        <span class="ticker-title">${item.title}</span>
        <span class="ticker-badge">${item.badge}</span>
        <span class="ticker-sub">(${item.text})</span>
      </div>
    `).join('');
  } catch (err) {
    console.error('Ошибка тикера:', err);
  }
}

// Управление AI-чатом
function toggleAIChat() {
  const sidebar = document.getElementById('aiPopupSidebar');
  if (!sidebar) return;

  if (sidebar.style.display === 'none' || sidebar.style.display === '') {
    sidebar.style.display = 'block';
    const input = document.getElementById('chatInput');
    if (input) input.focus();
  } else {
    sidebar.style.display = 'none';
  }
}

function handleChatKeyDown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessageToAI();
  }
}

async function sendMessageToAI() {
  const inputEl = document.getElementById('chatInput');
  if (!inputEl) return;
  const userText = inputEl.value.trim();
  if (!userText) return;

  inputEl.value = '';
  appendMessage(userText, 'user');
  const loadingBubble = appendMessage('Печатает...', 'ai loading');

  const selectedIndicator = document.getElementById('indicatorSelect')?.value || 'Не выбран';
  const selectedYear = document.getElementById('yearSelect')?.value || 'Не выбран';
  
  const contextPrompt = `
Контекст панели:
- Выбранный показатель: "${selectedIndicator}"
- Выбранный год: "${selectedYear}"

Вопрос пользователя: ${userText}
`;

  chatHistory.push({ role: 'user', parts: [{ text: contextPrompt }] });

  try {
    const response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: chatHistory,
        systemInstruction: {
          parts: [{ text: 'Ты экспертный ИИ-аналитик демографических данных Казахстана. Отвечай кратко, чётко и вежливо на русском языке.' }]
        }
      })
    });

    const data = await response.json();
    loadingBubble.remove();

    if (data.error) {
      appendMessage(`Ошибка: ${data.error.message}`, 'ai');
      return;
    }

    const aiReply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Не удалось получить ответ.';
    chatHistory.push({ role: 'model', parts: [{ text: aiReply }] });
    appendMessage(aiReply, 'ai');

  } catch (err) {
    loadingBubble.remove();
    appendMessage('Ошибка соединения с Gemini API.', 'ai');
  }
}

function appendMessage(text, type) {
  const chatMessages = document.getElementById('chatMessages');
  if (!chatMessages) return null;
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${type}`;
  bubble.innerText = text;
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return bubble;
}

// Управление категориями в сайдбаре
function toggleCategory(headerEl) {
  const sublist = headerEl.nextElementSibling;
  if (sublist) {
    sublist.style.display = sublist.style.display === 'none' ? 'flex' : 'none';
  }
}

// Выбор показателя кликом по сайдбару
function selectIndicator(indicatorName) {
  const select = document.getElementById('indicatorSelect');
  if (!select) return;
  
  let optionExists = false;
  for (let i = 0; i < select.options.length; i++) {
    if (select.options[i].value === indicatorName) {
      select.selectedIndex = i;
      optionExists = true;
      break;
    }
  }

  document.querySelectorAll('.subcat-item').forEach(el => el.classList.remove('active'));
  if (event && event.target) {
    event.target.classList.add('active');
  }

  if (optionExists) {
    onFilterChange();
  } else {
    console.warn(`Показатель "${indicatorName}" не найден в текущем списке бэкенда.`);
  }
}

// Переключение выдвижного сайдбара
function toggleSidebar() {
  const sidebar = document.getElementById('categorySidebar');
  const overlay = document.getElementById('sidebarOverlay');
  
  if (sidebar && overlay) {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('active');
  }
}

// Закрыть сайдбар при клике на оверлей
function closeSidebar() {
  const sidebar = document.getElementById('categorySidebar');
  const overlay = document.getElementById('sidebarOverlay');
  
  if (sidebar && overlay) {
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
  }
}

// Запуск приложения
initApp();