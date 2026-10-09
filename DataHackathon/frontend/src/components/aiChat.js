export let chatHistory = [];

export function toggleAIChat() {
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

export function handleChatKeyDown(event, sendMessageCallback) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    sendMessageCallback();
  }
}

export function appendMessage(text, type) {
  const chatMessages = document.getElementById('chatMessages');
  if (!chatMessages) return null;
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${type}`;
  bubble.innerText = text;
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return bubble;
}

export function cleanAIResponse(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/```[\w-]*\s*\n?/g, '')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]*(?:\d+[.)][ \t]*)?/gm, '')
    .replace(/^([ \t]*)[*+][ \t]+/gm, '$1— ')
    .replace(/\*\*(.*?)\*\*|__(.*?)__/g, (_match, stars, underscores) => stars || underscores)
    .replace(/(^|[\s([{«])\*([^*\n]+)\*(?=$|[\s.,!?;:)\]}»])/gm, '$1$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^[ \t]*(?:-{3,}|_{3,}|\*{3,})[ \t]*$/gm, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function initAIChat(apiBaseUrl) {
  window.sendMessageToAI = () => sendMessageToAI(apiBaseUrl);
  window.handleChatKeyDown = (event) => handleChatKeyDown(event, window.sendMessageToAI);
  initChartSuggestions();
}

function initChartSuggestions() {
  const chatMessages = document.getElementById('chatMessages');
  if (!chatMessages || document.getElementById('aiChartSuggestions')) return;

  const suggestions = document.createElement('div');
  suggestions.id = 'aiChartSuggestions';
  suggestions.className = 'ai-chat-suggestions';
  suggestions.setAttribute('aria-label', 'Примеры запросов для построения графика');
  [
    'Построй график распределения жителей по городу и селу за 2024 год по D008.',
    'Построй график доступности бытовых удобств по D006 за 2024 год.',
    'Покажи количество домохозяйств по территориям D004 за 2024 год.'
  ].forEach((prompt) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = prompt;
    button.addEventListener('click', () => {
      const input = document.getElementById('chatInput');
      if (!input || input.disabled) return;
      input.value = prompt;
      void window.sendMessageToAI();
    });
    suggestions.append(button);
  });
  chatMessages.after(suggestions);
}

function getDashboardContext() {
  const getSelection = (id) => {
    const select = document.getElementById(id);
    return select?.selectedOptions?.[0]?.textContent?.trim() || '';
  };

  const activeCategory = document.querySelector('.cat-header.active .cat-text');
  const activeDatasetItem = document.querySelector('.cat-subitem.active[data-search-dataset]');
  const activeDataset = activeDatasetItem?.dataset.searchDataset || '';
  const context = {
    category: activeCategory?.textContent?.trim() || '',
    activeDataset,
    indicator: getSelection('regionIndicatorSelect'),
    year: getSelection('regionYearSelect'),
    mapIndicator: getSelection('mapIndicatorSelect'),
    mapYear: getSelection('mapYearSelect'),
    summaryIndicator: getSelection('summaryIndicatorSelect')
  };

  if (activeDataset) {
    const datasetFilters = {
      year: document.getElementById(`${activeDataset}YearSelect`)?.value || ''
    };
    if (activeDataset === 'd002') {
      datasetFilters.form = document.getElementById('d002FormSelect')?.value || '';
    } else if (activeDataset === 'd004') {
      datasetFilters.quarter = document.getElementById('d004QuarterSelect')?.value || '';
      datasetFilters.module = document.getElementById('d004ModuleSelect')?.value || '';
    }
    context.datasetFilters = datasetFilters;
  }

  for (let card = 1; card <= 6; card += 1) {
    const indicator = getSelection(`card${card}Indicator`);
    const year = getSelection(`card${card}Year`);
    if (indicator || year) context[`card${card}`] = { indicator, year };
  }

  return context;
}

function appendChartMessage(chartData) {
  if (
    !chartData || !['bar', 'line', 'pie'].includes(chartData.chart_type)
    || !Array.isArray(chartData.labels) || !Array.isArray(chartData.values)
    || chartData.labels.length === 0 || chartData.labels.length > 30
    || chartData.labels.length !== chartData.values.length
    || chartData.labels.some((label) => typeof label !== 'string')
    || chartData.values.some((value) => !Number.isFinite(Number(value)))
  ) {
    throw new Error('ИИ вернул график в неподдерживаемом формате.');
  }
  if (!window.echarts) {
    throw new Error('Библиотека ECharts не загрузилась, график пока нельзя показать.');
  }

  const chatMessages = document.getElementById('chatMessages');
  if (!chatMessages) return;
  const card = document.createElement('section');
  card.className = 'chat-bubble ai chat-chart-card';
  const heading = document.createElement('h4');
  heading.textContent = chartData.title || 'График по данным';
  const caption = document.createElement('p');
  caption.textContent = chartData.subtitle || chartData.dataset || '';
  const chartElement = document.createElement('div');
  chartElement.className = 'chat-chart';
  chartElement.setAttribute('role', 'img');
  chartElement.setAttribute('aria-label', `${heading.textContent}. ${caption.textContent}`);
  card.append(heading, caption, chartElement);
  chatMessages.append(card);

  const darkTheme = document.body.classList.contains('dark-theme');
  const chart = window.echarts.init(chartElement, darkTheme ? 'dark' : undefined);
  const labels = chartData.labels;
  const values = chartData.values.map(Number);
  const suffix = typeof chartData.value_label === 'string' ? chartData.value_label : '';
  const escapeTooltipText = (value) => String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
  const option = {
    animationDuration: 500,
    color: ['#f2a77d', '#b99ac6', '#8ab6a4', '#e2c16e', '#7797bb'],
    tooltip: {
      trigger: chartData.chart_type === 'pie' ? 'item' : 'axis',
      formatter: chartData.chart_type === 'pie'
        ? (item) => `${escapeTooltipText(item.name)}<br><strong>${Number(item.value).toLocaleString('ru-RU')}${escapeTooltipText(suffix)}</strong> · ${item.percent}%`
        : (items) => {
          const item = Array.isArray(items) ? items[0] : items;
          if (!item) return '';
          return `${escapeTooltipText(item.axisValue)}<br><strong>${Number(item.value).toLocaleString('ru-RU')}${escapeTooltipText(suffix)}</strong>`;
        }
    },
    toolbox: { right: 8, feature: { saveAsImage: { title: 'Сохранить график', pixelRatio: 2 } } },
    grid: { left: 48, right: 18, top: 38, bottom: 54, containLabel: true },
    series: chartData.chart_type === 'pie'
      ? [{
        type: 'pie',
        radius: ['38%', '68%'],
        data: labels.map((name, index) => ({ name, value: values[index] })),
        label: { formatter: '{b}: {d}%' },
        emphasis: { scale: true }
      }]
      : [{
        type: chartData.chart_type,
        data: values,
        smooth: chartData.chart_type === 'line',
        showSymbol: chartData.chart_type === 'line',
        barMaxWidth: 40,
        label: { show: values.length <= 12, position: 'top', formatter: ({ value }) => `${Number(value).toLocaleString('ru-RU')}${suffix}` }
      }]
  };
  if (chartData.chart_type !== 'pie') {
    option.xAxis = { type: 'category', data: labels, axisLabel: { interval: 0, rotate: labels.length > 6 ? 30 : 0, hideOverlap: true } };
    option.yAxis = { type: 'value' };
  }
  chart.setOption(option);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  const resize = () => {
    if (chartElement.isConnected) chart.resize();
  };
  if (window.ResizeObserver) {
    const observer = new window.ResizeObserver(resize);
    observer.observe(chartElement);
  }
}

export async function sendMessageToAI(apiBaseUrl) {
  const input = document.getElementById('chatInput');
  const sendButton = document.getElementById('chatSendButton');
  const sendSpinner = sendButton?.querySelector('.chat-send-spinner');
  const message = input?.value.trim();
  if (!message || !input) return;

  appendMessage(message, 'user');
  input.value = '';
  input.disabled = true;
  if (sendButton) {
    sendButton.disabled = true;
  }
  if (sendButton) {
    sendButton.setAttribute('aria-busy', 'true');
    sendButton.classList.add('is-loading');
  }
  if (sendSpinner) sendSpinner.hidden = false;
  const loadingBubble = appendMessage('Формирую ответ…', 'ai');
  if (loadingBubble) {
    loadingBubble.classList.add('chat-loading');
    loadingBubble.innerHTML = '<span class="loading-spinner" aria-hidden="true"></span><span>Формирую ответ…</span>';
  }

  const nextHistory = [...chatHistory, { role: 'user', text: message }].slice(-10);

  try {
    const response = await fetch(`${apiBaseUrl}/api/ai-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: nextHistory,
        dashboard_context: getDashboardContext()
      })
    });
    const responseText = await response.text();
    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      const message = response.status >= 500
        ? `Ошибка Flask API (HTTP ${response.status}). Проверьте traceback в терминале backend.`
        : `Flask API вернул не JSON (HTTP ${response.status}). Проверьте, что запрос отправлен на актуальный сервер.`;
      throw new Error(message);
    }
    if (!response.ok) {
      const errorMessage = typeof result.error === 'string'
        ? result.error
        : result.error?.message;
      throw new Error(errorMessage || 'Не удалось получить ответ ИИ.');
    }
    if (typeof result.answer !== 'string' || !result.answer.trim()) {
      throw new Error('Flask API не вернул текст ответа.');
    }

    const answer = cleanAIResponse(result.answer);
    if (!answer) {
      throw new Error('После очистки форматирования ответ ИИ оказался пустым.');
    }
    chatHistory = [...nextHistory, { role: 'model', text: answer }].slice(-10);
    appendMessage(answer, 'ai');
    if (result.chart) {
      try {
        appendChartMessage(result.chart);
      } catch (error) {
        appendMessage(error.message || 'Не удалось отобразить график.', 'ai');
      }
    }
  } catch (error) {
    const errorMessage = error.message || '';
    const friendlyMessage = /Claude API \(429\)|HTTP 429|rate.?limit|quota/i.test(errorMessage)
      ? 'Временно достигнут лимит запросов Claude. Попробуйте позже.'
      : errorMessage || 'Не удалось получить ответ ИИ. Проверьте подключение и попробуйте ещё раз.';
    appendMessage(friendlyMessage, 'ai');
  } finally {
    loadingBubble?.remove();
    input.disabled = false;
    if (sendButton) {
      sendButton.disabled = false;
      sendButton.removeAttribute('aria-busy');
      sendButton.classList.remove('is-loading');
    }
    if (sendSpinner) sendSpinner.hidden = true;
    input.focus();
  }
}
