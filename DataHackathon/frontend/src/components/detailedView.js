import { fetchAIAnalysisForChart } from './claudeService.js';

let detailedEChartInstance = null;

export function openDetailedAnalytics(chartTitle, analyticsText, sourceChartElementId) {
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
}

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

export async function openAnalyticsFromCard(buttonElement, apiBaseUrl) {
  const card = buttonElement.closest('.sub-chart-card');
  if (!card) return;

  const select = card.querySelector('select');
  const indicatorName = select ? select.options[select.selectedIndex].text : 'График данных';

  const activeCategoryEl = document.querySelector('.cat-header.active .cat-text');
  const categoryName = activeCategoryEl ? activeCategoryEl.innerText : 'Общие данные';

  const chartDiv = card.querySelector('[id^="chartType"], [id$="Chart"]');
  const chartId = chartDiv ? chartDiv.id : null;
  const chartOption = chartDiv && window.echarts?.getInstanceByDom(chartDiv)?.getOption();
  const chartContext = {
    indicator: indicatorName,
    category: categoryName,
    year: card.querySelector('select[id$="Year"]')?.value || '',
    chart: chartOption ? {
      labels: chartOption.xAxis?.[0]?.data?.slice(0, 100) || [],
      series: (chartOption.series || []).slice(0, 10).map(series => ({
        name: series.name || '',
        type: series.type || '',
        values: (series.data || []).slice(0, 100).map(point => (
          typeof point === 'object' && point !== null ? point.value ?? point[0] ?? null : point
        ))
      }))
    } : {}
  };

  openDetailedAnalytics(
    indicatorName,
    "⏳ Генерация ИИ-аналитики с помощью Claude...",
    chartId
  );

  let realAnalysisText;
  try {
    realAnalysisText = await fetchAIAnalysisForChart(indicatorName, categoryName, apiBaseUrl, chartContext);
  } catch (error) {
    realAnalysisText = error.message || 'Не удалось получить анализ графика.';
  }

  const descEl = document.getElementById('aiAnalyticsDescription');
  if (descEl) {
    descEl.innerText = realAnalysisText;
  }
}

export function initDetailedViewClose() {
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
}

export function getDetailedInstance() {
  return detailedEChartInstance;
}