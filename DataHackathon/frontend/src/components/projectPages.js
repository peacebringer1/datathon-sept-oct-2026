export function initProjectPages() {
  const profiles = {
    data: [5, 8, 9, 2, 2],
    engineering: [6, 9, 10, 4, 2],
    product: [10, 5, 5, 10, 7],
    assistant: [8, 3, 3, 9, 10],
    communication: [5, 5, 5, 5, 5]
  };
  const renderMemberCharts = () => {
    if (!window.echarts) return;
    document.querySelectorAll('[data-member-chart]').forEach((element) => {
      const chart = window.echarts.getInstanceByDom(element) || window.echarts.init(element, null, { renderer: 'svg' });
      const dark = document.body.classList.contains('dark-theme');
      const palette = document.body.dataset.stylePreset === 'classic'
        ? ['#cf7f5f', '#a78bb5', '#c58eaa', '#e1a07f', '#9b82a6', '#765f80']
        : ['#17b981', '#50b9d2', '#46cbb0', '#7fdef5', '#7ef5ad', '#13966d'];
      chart.setOption({
        animation: false,
        radar: {
          indicator: [
            { name: 'Frontend', max: 10 }, { name: 'Backend', max: 10 },
            { name: 'Data', max: 10 }, { name: 'Design', max: 10 }, { name: 'AI', max: 10 }
          ],
          radius: '66%', center: ['50%', '55%'], splitNumber: 4,
          axisName: { color: dark ? '#d4c7d5' : '#776d78', fontSize: 13 },
          axisLine: { lineStyle: { color: dark ? 'rgba(201,170,206,.28)' : 'rgba(137,111,144,.2)' } },
          splitLine: { lineStyle: { color: dark ? 'rgba(201,170,206,.2)' : 'rgba(137,111,144,.14)' } },
          splitArea: { areaStyle: { color: dark ? ['rgba(201,170,206,.02)', 'rgba(201,170,206,.05)'] : ['rgba(201,170,206,.025)', 'rgba(201,170,206,.07)'] } }
        },
        series: [{ type: 'radar', symbol: 'circle', symbolSize: 3,
          lineStyle: { color: palette[0], width: 2 },
          itemStyle: { color: palette[1] },
          areaStyle: { color: `${palette[1]}38` },
          data: [{ value: profiles[element.dataset.memberChart] || [5, 5, 5, 5, 5] }]
        }]
      }, true);
    });
  };
  const resizeMemberCharts = () => {
    document.querySelectorAll('[data-member-chart]').forEach((element) => {
      window.echarts?.getInstanceByDom(element)?.resize();
    });
  };
  renderMemberCharts();
  if ('ResizeObserver' in window) {
    const memberChartObserver = new ResizeObserver((entries) => {
      const visibleCharts = entries
        .filter(({ contentRect }) => contentRect.width > 0 && contentRect.height > 0)
        .map(({ target }) => window.echarts?.getInstanceByDom(target))
        .filter(Boolean);
      if (!visibleCharts.length) return;
      requestAnimationFrame(() => visibleCharts.forEach((chart) => chart.resize()));
    });
    document.querySelectorAll('[data-member-chart]').forEach((element) => memberChartObserver.observe(element));
  }
  let chartResizeFrame = 0;
  window.addEventListener('resize', () => {
    if (chartResizeFrame) cancelAnimationFrame(chartResizeFrame);
    chartResizeFrame = requestAnimationFrame(resizeMemberCharts);
  }, { passive: true });
  window.addEventListener('app-theme-changed', renderMemberCharts);
  window.addEventListener('app-style-preset-changed', renderMemberCharts);
  document.querySelectorAll('.about-team-card').forEach((card) => {
    card.addEventListener('click', () => {
      if (window.matchMedia('(hover: none)').matches) card.classList.toggle('is-flipped');
    });
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') card.classList.remove('is-flipped');
    });
  });

  const filterButtons = [...document.querySelectorAll('[data-hypothesis-filter]')];
  const cards = [...document.querySelectorAll('[data-hypothesis-card]')];

  filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const filter = button.dataset.hypothesisFilter;
      filterButtons.forEach((item) => {
        const selected = item === button;
        item.classList.toggle('active', selected);
        item.setAttribute('aria-pressed', String(selected));
      });
      cards.forEach((card) => {
        const matches = filter === 'all' || card.dataset.hypothesisCard === filter;
        card.hidden = !matches;
      });
    });
  });

  document.querySelectorAll('[data-open-dataset]').forEach((button) => {
    button.addEventListener('click', () => {
      const dataset = button.dataset.openDataset;
      const sidebarItem = document.getElementById(`nav${dataset.toUpperCase()}`);
      window.switchSubSection?.(dataset, sidebarItem || button);
    });
  });
}

document.addEventListener('DOMContentLoaded', initProjectPages);
