import { cleanAIResponse } from './aiChat.js';

const pendingAnalyses = new Map();
let isProcessingQueue = false;

function getChartData(chartElement) {
  const chart = window.echarts?.getInstanceByDom(chartElement);
  if (!chart) return null;

  const option = chart.getOption();
  const labels = option.xAxis?.[0]?.data || [];
  const datasetRows = option.dataset?.[0]?.source;
  const series = (option.series || []).slice(0, 10).map((item) => {
    if (Array.isArray(item.data) && item.data.length) {
      return {
        name: item.name || '',
        type: item.type || '',
        points: item.data.slice(0, 100).map((point, index) => {
          if (point && typeof point === 'object' && !Array.isArray(point)) {
            return {
              label: point.name || labels[index] || '',
              value: point.value ?? null
            };
          }
          return { label: labels[index] || String(index + 1), value: point };
        })
      };
    }

    if (Array.isArray(datasetRows) && datasetRows.length > 1) {
      return {
        name: item.name || '',
        type: item.type || '',
        points: datasetRows.slice(1, 101).map((row) => ({
          label: Array.isArray(row) ? String(row[1] ?? '') : '',
          value: Array.isArray(row) ? row[0] ?? null : null
        }))
      };
    }

    return { name: item.name || '', type: item.type || '', points: [] };
  }).filter((item) => item.points.length);

  if (!series.length) return null;
  return { labels: labels.slice(0, 100), series };
}

function getAnalysisElement(chartElement) {
  let analysisElement = chartElement.parentElement.querySelector('.chart-ai-analysis');
  if (!analysisElement) {
    analysisElement = document.createElement('section');
    analysisElement.className = 'chart-ai-analysis';
    analysisElement.setAttribute('aria-live', 'polite');
    chartElement.insertAdjacentElement('afterend', analysisElement);
  }
  return analysisElement;
}

function renderLoading(element) {
  element.replaceChildren();
  const heading = document.createElement('h4');
  heading.textContent = 'ИИ-анализ и гипотезы';
  const text = document.createElement('p');
  text.textContent = 'ИИ анализирует данные графика и готовит гипотезы…';
  element.append(heading, text);
}

function renderError(element, message, retry) {
  element.replaceChildren();
  const heading = document.createElement('h4');
  heading.textContent = 'ИИ-анализ и гипотезы';
  const text = document.createElement('p');
  const quotaExceeded = /Gemini API \(429\)|HTTP 429|quota|exceeded your current quota/i.test(message);
  text.textContent = quotaExceeded
    ? 'Лимит запросов Gemini исчерпан. Попробуйте получить анализ позже.'
    : 'Не удалось получить анализ. Проверьте подключение и попробуйте ещё раз.';
  const details = document.createElement('details');
  const detailsSummary = document.createElement('summary');
  detailsSummary.textContent = 'Технические сведения';
  const detailsText = document.createElement('p');
  detailsText.className = 'chart-ai-error-details';
  detailsText.textContent = message;
  details.append(detailsSummary, detailsText);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'chart-ai-retry';
  button.textContent = 'Повторить';
  button.addEventListener('click', retry, { once: true });
  element.append(heading, text, details, button);
}

async function requestAnalysis(job) {
  const { element, apiBaseUrl, requestId, context } = job;
  try {
    const response = await fetch(`${apiBaseUrl}/api/chart-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(context)
    });
    const result = await response.json();
    if (!response.ok) {
      const message = typeof result.error === 'string'
        ? result.error
        : result.error?.message;
      throw new Error(message || `Ошибка сервера (HTTP ${response.status}).`);
    }
    if (!result.analysis || typeof result.analysis !== 'object' || Array.isArray(result.analysis)) {
      throw new Error('ИИ вернул пустой анализ.');
    }
    const analysis = result.analysis;
    if (
      typeof analysis.trend !== 'string'
      || !analysis.trend.trim()
      || !Array.isArray(analysis.observations)
      || !analysis.observations.length
      || analysis.observations.some(observation => typeof observation !== 'string' || !observation.trim())
      || !Array.isArray(analysis.hypotheses)
      || analysis.hypotheses.length < 2
      || analysis.hypotheses.some(hypothesis => typeof hypothesis !== 'string' || !hypothesis.trim())
    ) {
      throw new Error('ИИ вернул анализ в неожиданном формате.');
    }

    if (element.dataset.requestId !== requestId) return;
    element.replaceChildren();
    const heading = document.createElement('h4');
    heading.textContent = 'ИИ-анализ и гипотезы';
    const trendSection = document.createElement('div');
    trendSection.className = 'chart-ai-trend';
    const trendLabel = document.createElement('h5');
    trendLabel.textContent = 'Что видно на графике';
    const trendText = document.createElement('p');
    trendText.textContent = cleanAIResponse(analysis.trend);
    trendSection.append(trendLabel, trendText);

    const observationsSection = document.createElement('div');
    observationsSection.className = 'chart-ai-observations';
    const observationsLabel = document.createElement('h5');
    observationsLabel.textContent = 'Ключевые наблюдения';
    const observationsList = document.createElement('ul');
    analysis.observations.slice(0, 3).forEach((observation) => {
      const item = document.createElement('li');
      item.textContent = cleanAIResponse(observation);
      observationsList.appendChild(item);
    });
    observationsSection.append(observationsLabel, observationsList);

    const hypothesesSection = document.createElement('div');
    hypothesesSection.className = 'chart-ai-hypotheses';
    const hypothesesLabel = document.createElement('h5');
    hypothesesLabel.textContent = 'Возможные гипотезы';
    const hypothesesList = document.createElement('ul');
    analysis.hypotheses.slice(0, 3).forEach((hypothesis) => {
      const item = document.createElement('li');
      item.textContent = cleanAIResponse(hypothesis);
      hypothesesList.appendChild(item);
    });
    hypothesesSection.append(hypothesesLabel, hypothesesList);
    element.append(heading, trendSection, observationsSection, hypothesesSection);
  } catch (error) {
    if (element.dataset.requestId !== requestId) return;
    renderError(element, error.message || 'Ошибка соединения с сервером.', () => {
      updateChartAnalysis(
        job.chartId,
        job.apiBaseUrl,
        job.indicator,
        job.category,
        job.year
      );
    });
  }
}

async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;
  try {
    while (pendingAnalyses.size) {
      const [element, job] = pendingAnalyses.entries().next().value;
      pendingAnalyses.delete(element);
      await requestAnalysis(job);
    }
  } finally {
    isProcessingQueue = false;
    if (pendingAnalyses.size) void processQueue();
  }
}

export function updateChartAnalysis(chartId, apiBaseUrl, indicator, category, year = '') {
  const chartElement = document.getElementById(chartId);
  if (!chartElement) return;

  const data = getChartData(chartElement);
  if (!data) return;

  const element = getAnalysisElement(chartElement);
  const requestId = String(Number(element.dataset.requestId || 0) + 1);
  element.dataset.requestId = requestId;
  renderLoading(element);

  const context = {
    indicator,
    category,
    year,
    chart: {
      title: window.echarts.getInstanceByDom(chartElement).getOption().title?.[0]?.text || indicator,
      ...data
    }
  };
  pendingAnalyses.delete(element);
  pendingAnalyses.set(element, {
    element,
    chartId,
    apiBaseUrl,
    indicator,
    category,
    year,
    requestId,
    context
  });
  void processQueue();
}
