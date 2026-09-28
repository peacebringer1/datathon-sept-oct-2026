import { fetchAIAnalysisForChart } from './geminiService.js';

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

export async function openAnalyticsFromCard(buttonElement) {
  const card = buttonElement.closest('.sub-chart-card');
  if (!card) return;

  const select = card.querySelector('select');
  const indicatorName = select ? select.options[select.selectedIndex].text : 'График данных';
  
  const activeCategoryEl = document.querySelector('.cat-header.active .cat-text');
  const categoryName = activeCategoryEl ? activeCategoryEl.innerText : 'Общие данные';

  const chartDiv = card.querySelector('[id^="chartType"], [id$="Chart"]');
  const chartId = chartDiv ? chartDiv.id : null;

  openDetailedAnalytics(
    indicatorName,
    "⏳ Генерация ИИ-аналитики с помощью Gemini...",
    chartId
  );

  const realAnalysisText = await fetchAIAnalysisForChart(indicatorName, categoryName);

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