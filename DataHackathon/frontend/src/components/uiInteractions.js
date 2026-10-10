import { yearChartInstance, lineChartInstance, pieChartInstance, hBarChartInstance, stackedAreaChartInstance, summaryChartInstance, multiSummaryChartInstance, kzMapInstance, updateMultiSummaryChart, updateChartThemeColors } from './chartsMap.js';
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
  const styleButton = document.getElementById('stylePresetToggleBtn');
  const styleMenu = document.getElementById('stylePresetMenu');
  const styleOptions = [...(styleMenu?.querySelectorAll('[data-style-preset]') || [])];
  const stylePalettes = {
    classic: ['#a78bfa', '#7c9cff', '#6ee7f9', '#5be7c4', '#a3f7bd', '#b8a6ff'],
    green: ['#17b981', '#50b9d2', '#46cbb0', '#7fdef5', '#7ef5ad', '#13966d']
  };
  const applyStylePreset = (preset) => {
    if (!stylePalettes[preset]) return;
    window.appChartPalette = stylePalettes[preset];
    document.body.dataset.stylePreset = preset;
    localStorage.setItem('app-style-preset', preset);
    styleOptions.forEach((option) => option.setAttribute('aria-pressed', String(option.dataset.stylePreset === preset)));
    document.querySelectorAll('[_echarts_instance_]').forEach((element) => {
      window.echarts?.getInstanceByDom(element)?.setOption({ color: stylePalettes[preset] });
    });
    window.dispatchEvent(new CustomEvent('app-style-preset-changed', { detail: { preset } }));
  };
  const savedPreset = localStorage.getItem('app-style-preset');
  applyStylePreset(savedPreset === 'classic' ? 'classic' : 'green');
  styleButton?.addEventListener('click', () => {
    const opening = styleMenu?.hidden ?? false;
    if (!styleMenu) return;
    styleMenu.hidden = !opening;
    styleButton.setAttribute('aria-expanded', String(opening));
  });
  styleOptions.forEach((option) => option.addEventListener('click', () => {
    applyStylePreset(option.dataset.stylePreset);
    if (styleMenu) styleMenu.hidden = true;
    styleButton?.setAttribute('aria-expanded', 'false');
  }));
  document.addEventListener('click', (event) => {
    if (!styleMenu || styleMenu.hidden || event.target.closest('.style-preset-container')) return;
    styleMenu.hidden = true;
    styleButton?.setAttribute('aria-expanded', 'false');
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

      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (document.startViewTransition && !reduceMotion) {
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
      updateChartThemeColors();
      window.dispatchEvent(new Event('app-theme-changed'));
      window.dispatchEvent(new Event('resize'));
    });
  }
}

export function initGlobalResizeListener() {
  let resizeFrame = 0;
  const observedCharts = new WeakSet();
  const chartResizeObserver = 'ResizeObserver' in window
    ? new ResizeObserver((entries) => {
      entries.forEach(({ target, contentRect }) => {
        if (contentRect.width <= 0 || contentRect.height <= 0) return;
        window.echarts?.getInstanceByDom(target)?.resize();
      });
    })
    : null;
  const observeCharts = () => {
    if (!chartResizeObserver || !window.echarts) return;
    document.querySelectorAll('[_echarts_instance_]').forEach((element) => {
      if (observedCharts.has(element)) return;
      observedCharts.add(element);
      chartResizeObserver.observe(element);
    });
  };
  const resizeAllCharts = () => {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      if (window.echarts) {
        document.querySelectorAll('[_echarts_instance_]').forEach((element) => {
          window.echarts.getInstanceByDom(element)?.resize();
        });
      }
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
  };

  window.addEventListener('resize', resizeAllCharts);
  const content = document.querySelector('.main-content-area');
  if (content && 'ResizeObserver' in window) {
    const observer = new ResizeObserver(resizeAllCharts);
    observer.observe(content);
    observer.observe(document.querySelector('.container') || content);
  }
  observeCharts();
  if ('MutationObserver' in window && document.body) {
    const chartMountObserver = new MutationObserver(() => observeCharts());
    chartMountObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['_echarts_instance_']
    });
  }
}
