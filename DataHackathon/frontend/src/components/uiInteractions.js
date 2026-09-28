import { yearChartInstance, lineChartInstance, pieChartInstance, hBarChartInstance, stackedAreaChartInstance, summaryChartInstance, multiSummaryChartInstance, kzMapInstance, updateMultiSummaryChart } from './chartsMap.js';
import { getDetailedInstance } from './detailedView.js';

let activeTab = 'year';
let customCardChartType = 'bar';

export function switchTab(tab, API_BASE_URL) {
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
      if (typeof multiSummaryChartInstance !== 'undefined' && multiSummaryChartInstance) {
        multiSummaryChartInstance.resize();
      } else {
        updateMultiSummaryChart(API_BASE_URL);
      }
    }, 50);
  }
}

export function openAddChartModal() {
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
}

export function closeAddChartModal() {
  document.getElementById('addChartModal').style.display = 'none';
}

export async function saveCustomCard(onCardFilterChangeCallback) {
  const selectedInd = document.getElementById('modalIndicatorSelect').value;
  const selectedYear = document.getElementById('modalYearSelect').value;
  const selectedType = document.getElementById('modalChartType').value;

  customCardChartType = selectedType;

  document.getElementById('customCardPrompt').style.display = 'none';
  document.getElementById('customCardHeader').style.display = 'flex';
  
  const customCard = document.getElementById('chartTypeCustom');
  customCard.style.display = 'block';

  document.getElementById('card6Indicator').value = selectedInd;
  document.getElementById('card6Year').value = selectedYear;

  closeAddChartModal();
  await onCardFilterChangeCallback(6, customCardChartType);
}

export function resetCustomCard() {
  document.getElementById('customCardPrompt').style.display = 'flex';
  document.getElementById('customCardHeader').style.display = 'none';
  document.getElementById('chartTypeCustom').style.display = 'none';
  document.getElementById('chartTypeCustom').innerHTML = '';
}

export function initThemeToggle() {
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
}

export function initGlobalResizeListener() {
  window.addEventListener('resize', () => {
    if (yearChartInstance) yearChartInstance.resize();
    if (lineChartInstance) lineChartInstance.resize();
    if (pieChartInstance) pieChartInstance.resize();
    if (hBarChartInstance) hBarChartInstance.resize();
    if (stackedAreaChartInstance) stackedAreaChartInstance.resize();
    if (summaryChartInstance) summaryChartInstance.resize();
    if (typeof multiSummaryChartInstance !== 'undefined' && multiSummaryChartInstance) {
      multiSummaryChartInstance.resize();
    }
    if (kzMapInstance) kzMapInstance.resize();
    
    const detailedEChartInstance = getDetailedInstance();
    if (detailedEChartInstance) detailedEChartInstance.resize();
  });
}