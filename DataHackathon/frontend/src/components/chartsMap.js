import { updateChartAnalysis } from './chartAnalysis.js';

export let yearChartInstance = null; // Первый график (барчарт)
export let lineChartInstance = null; // Второй график (линейный со сглаживанием)
export let pieChartInstance = null;  // Третий график (круговой)
export let hBarChartInstance = null; // Четвертый график (горизонтальный bar с visualMap)
export let stackedAreaChartInstance = null; // Пятый график (ECharts Bar Animation Delay)
export let customChartInstance = null; // Кастомный график (Карточка 6)

export let summaryChartInstance = null;
export let multiSummaryChartInstance = null; // Инстанс мульти-графика
export let kzMapInstance = null;
let cachedKZJson = null;
<<<<<<< HEAD
let isMapActive = false;
=======
>>>>>>> dc8732dbe208308ef095b862befeb070e1b443be

const commonToolbox = {
  feature: {
    dataView: { readOnly: true, title: 'Data view' },
    saveAsImage: { pixelRatio: 2, title: 'Save as Image' }
  }
};

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

function resizeActiveCharts() {
  const instances = [
    yearChartInstance,
    lineChartInstance,
    pieChartInstance,
    hBarChartInstance,
    stackedAreaChartInstance,
    customChartInstance,
    summaryChartInstance,
    multiSummaryChartInstance,
    kzMapInstance
  ];
  instances.forEach(chart => {
    if (chart && typeof chart.resize === 'function') {
      chart.resize();
    }
  });
}

// Функция для принудительного ресайза всех активных графиков при изменении размера окна
window.addEventListener('resize', resizeActiveCharts);

const mainContent = document.querySelector('.main-content-area');
if (mainContent && typeof ResizeObserver !== 'undefined') {
  let resizeScheduled = false;
  const contentResizeObserver = new ResizeObserver(() => {
    if (resizeScheduled) return;
    resizeScheduled = true;
    requestAnimationFrame(() => {
      resizeScheduled = false;
      resizeActiveCharts();
    });
  });
  contentResizeObserver.observe(mainContent);
}

// 1. Обновление первого графика (Карточка 1)
export async function updateBarChart(apiBaseUrl, indicator, year) {
  if (!indicator || !year) return;
  try {
    const res = await fetch(`${apiBaseUrl}/api/chart-year?indicator=${encodeURIComponent(indicator)}&year=${year}`);
    const { labels, values } = await res.json();

    const domBar = document.getElementById('chartTypeBar');
    if (domBar) {
      if (!yearChartInstance) yearChartInstance = echarts.init(domBar);
      yearChartInstance.setOption({
        animation: true,
        animationDuration: 1000,
        title: { text: window.activeAnalyzerDatasetMode === 'distribution' ? 'Распределение ответов' : 'Распределение по регионам', left: 'center', textStyle: { fontSize: 13, color: getThemeColors().textColor } },
        toolbox: commonToolbox,
        tooltip: { trigger: 'axis', formatter: (p) => `<b>${p[0].name}</b><br/>${indicator}: <b>${p[0].value.toLocaleString('ru-RU')}</b>` },
        grid: { top: '22%', bottom: '15%', left: '8%', right: '5%', containLabel: true },
        xAxis: { type: 'category', data: labels, axisLabel: { interval: 0, rotate: 35, fontSize: 9, color: getThemeColors().textColor } },
        yAxis: { type: 'value', axisLabel: { fontSize: 10, color: getThemeColors().textColor }, splitLine: { lineStyle: { color: '#f1f5f9' } } },
        series: [{
          data: values,
          type: 'bar',
          showBackground: true,
          backgroundStyle: { color: 'rgba(180, 180, 180, 0.15)', borderRadius: [4, 4, 0, 0] },
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#3b82f6' }, { offset: 1, color: '#1d4ed8' }]),
            borderRadius: [4, 4, 0, 0]
          },
          barMaxWidth: 25
        }]
      });
      yearChartInstance.resize();
    }
  } catch (e) {
    console.error('Ошибка загрузки первого графика:', e);
  }
}

// 2. Обновление второго графика (Карточка 2)
export async function updateLineChart(apiBaseUrl, indicator, year) {
  if (!indicator || !year) return;
  try {
    const res = await fetch(`${apiBaseUrl}/api/chart-year?indicator=${encodeURIComponent(indicator)}&year=${year}`);
    const { labels, values } = await res.json();

    const domLine = document.getElementById('chartTypeLine');
    if (domLine) {
      if (!lineChartInstance) lineChartInstance = echarts.init(domLine);
      lineChartInstance.setOption({
        animation: true,
        animationDuration: 1000,
        title: { text: window.activeAnalyzerDatasetMode === 'distribution' ? 'Частота ответов' : 'Динамика показателей', left: 'center', textStyle: { fontSize: 13, color: getThemeColors().textColor } },
        toolbox: commonToolbox,
        tooltip: { trigger: 'axis' },
        grid: { top: '22%', bottom: '15%', left: '8%', right: '5%', containLabel: true },
        xAxis: { type: 'category', data: labels, axisLabel: { interval: 0, rotate: 35, fontSize: 9, color: getThemeColors().textColor } },
        yAxis: { type: 'value', axisLabel: { fontSize: 10, color: getThemeColors().textColor }, splitLine: { lineStyle: { color: '#f1f5f9' } } },
        series: [{
          data: values,
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          itemStyle: { color: '#0770FF' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(7, 112, 255, 0.6)' },
              { offset: 1, color: 'rgba(7, 112, 255, 0.05)' }
            ])
          }
        }]
      });
      lineChartInstance.resize();
    }
  } catch (e) {
    console.error('Ошибка загрузки второго графика:', e);
  }
}

// 3. Обновление третьего графика (Карточка 3)
export async function updatePieChart(apiBaseUrl, indicator, year) {
  if (!indicator || !year) return;
  try {
    const res = await fetch(`${apiBaseUrl}/api/chart-year?indicator=${encodeURIComponent(indicator)}&year=${year}`);
    const { labels, values } = await res.json();

    const pieData = labels.map((lbl, idx) => ({ name: lbl, value: values[idx] })).filter(item => item.value > 0);
    const domPie = document.getElementById('chartTypePie');
    if (domPie) {
      if (!pieChartInstance) pieChartInstance = echarts.init(domPie);
      pieChartInstance.setOption({
        animation: true,
        animationDuration: 1000,
        title: { text: window.activeAnalyzerDatasetMode === 'distribution' ? 'Доли вариантов ответа' : 'Доли по регионам', left: 'center', textStyle: { fontSize: 13, color: getThemeColors().textColor } },
        toolbox: commonToolbox,
        tooltip: { trigger: 'item', formatter: '{b}: <b>{c}</b> ({d}%)' },
        legend: { type: 'scroll', orient: 'vertical', left: 'left', top: '15%', textStyle: { fontSize: 9, color: getThemeColors().textColor } },
        series: [{
          type: 'pie',
          radius: ['35%', '60%'],
          center: ['65%', '55%'],
          avoidLabelOverlap: false,
          label: { show: false },
          data: pieData
        }]
      });
      pieChartInstance.resize();
    }
  } catch (e) {
    console.error('Ошибка загрузки третьего графика:', e);
  }
}

// 4. Обновление четвертого графика (Карточка 4) - Горизонтальная шкала с visualMap
export async function updateHBarChart(apiBaseUrl, indicator, year) {
  if (!indicator || !year) return;
  try {
    const res = await fetch(`${apiBaseUrl}/api/chart-year?indicator=${encodeURIComponent(indicator)}&year=${year}`);
    const { labels, values } = await res.json();

    const domHBar = document.getElementById('chartTypeHBar');
    if (domHBar) {
      if (!hBarChartInstance) hBarChartInstance = echarts.init(domHBar);

      const sourceData = [['value', 'region']];
      values.forEach((val, idx) => {
        sourceData.push([val, labels[idx]]);
      });

      const minVal = values.length ? Math.min(...values) : 0;
      const maxVal = values.length ? Math.max(...values) : 100;

      hBarChartInstance.setOption({
        animation: true,
        animationDuration: 1000,
        title: { text: window.activeAnalyzerDatasetMode === 'distribution' ? 'Частота вариантов ответа' : 'Рейтинг регионов', left: 'center', textStyle: { fontSize: 13, color: getThemeColors().textColor } },
        toolbox: commonToolbox,
        tooltip: { trigger: 'axis', formatter: (p) => `<b>${p[0].data[1]}</b><br/>${indicator}: <b>${p[0].data[0].toLocaleString('ru-RU')}</b>` },
        dataset: { source: sourceData },
        grid: { containLabel: true, top: '18%', bottom: '22%', left: '5%', right: '5%' },
        xAxis: { type: 'value', axisLabel: { fontSize: 9, color: getThemeColors().textColor }, splitLine: { lineStyle: { color: '#f1f5f9' } } },
        yAxis: { type: 'category', axisLabel: { fontSize: 9, color: getThemeColors().textColor } },
        visualMap: {
          orient: 'horizontal',
          left: 'center',
          bottom: '2%',
          itemWidth: 12,
          itemHeight: 100,
          textStyle: { fontSize: 9, color: getThemeColors().textColor },
          min: minVal,
          max: maxVal === minVal ? maxVal + 1 : maxVal,
          text: ['Макс', 'Мин'],
          dimension: 0,
          inRange: { color: ['#65B581', '#FFCE34', '#FD665F'] }
        },
        series: [{
          type: 'bar',
          encode: { x: 'value', y: 'region' },
          itemStyle: { borderRadius: [0, 4, 4, 0] }
        }]
      });
      hBarChartInstance.resize();
    }
  } catch (e) {
    console.error('Ошибка загрузки четвертого графика:', e);
  }
}

// 5. Обновление пятого графика (Карточка 5)
export async function updateStackedAreaChart(apiBaseUrl, indicator, year) {
  if (!indicator || !year) return;
  try {
    const res = await fetch(`${apiBaseUrl}/api/chart-year?indicator=${encodeURIComponent(indicator)}&year=${year}`);
    const { labels, values } = await res.json();

    const dom = document.getElementById('barAnimationChart');
    if (dom) {
      if (!stackedAreaChartInstance) stackedAreaChartInstance = echarts.init(dom);

      stackedAreaChartInstance.setOption({
        animation: true,
        title: { text: `${indicator} (${year})`, left: 'center', textStyle: { fontSize: 12, color: getThemeColors().textColor } },
        toolbox: { feature: { magicType: { type: ['stack'] }, dataView: { readOnly: true }, saveAsImage: { pixelRatio: 2 } } },
        tooltip: { trigger: 'axis' },
        grid: { top: '25%', bottom: '15%', left: '8%', right: '5%', containLabel: true },
        xAxis: { data: labels, splitLine: { show: false }, axisLabel: { interval: 0, rotate: 35, fontSize: 9, color: getThemeColors().textColor } },
        yAxis: { type: 'value', axisLabel: { fontSize: 10, color: getThemeColors().textColor }, splitLine: { lineStyle: { color: '#f1f5f9' } } },
        series: [
          {
            name: indicator,
            type: 'bar',
            data: values,
            itemStyle: { color: '#3b82f6', borderRadius: [4, 4, 0, 0] },
            emphasis: { focus: 'series' },
            animationDelay: function (idx) { return idx * 20; }
          }
        ],
        animationEasing: 'elasticOut',
        animationDelayUpdate: function (idx) { return idx * 5; }
      });
      stackedAreaChartInstance.resize();
    }
  } catch (e) {
    console.error('Ошибка загрузки анимированного графика:', e);
  }
}

// 6. Обновление кастомного графика (Карточка 6)
export async function updateCustomChart(apiBaseUrl, indicator, year, chartType) {
  if (!indicator || !year) return;
  try {
    const res = await fetch(`${apiBaseUrl}/api/chart-year?indicator=${encodeURIComponent(indicator)}&year=${year}`);
    const { labels, values } = await res.json();

    const domCustom = document.getElementById('chartTypeCustom');
    if (domCustom) {
      if (!customChartInstance) {
        customChartInstance = echarts.init(domCustom);
      }

      let option = {
        animation: true,
        animationDuration: 1000,
        toolbox: commonToolbox,
        grid: { top: '22%', bottom: '15%', left: '8%', right: '5%', containLabel: true },
        xAxis: { type: 'category', data: labels, axisLabel: { interval: 0, rotate: 35, fontSize: 9, color: getThemeColors().textColor } },
        yAxis: { type: 'value', axisLabel: { fontSize: 10, color: getThemeColors().textColor }, splitLine: { lineStyle: { color: '#f1f5f9' } } }
      };

      if (chartType === 'line') {
        option.title = { text: `Динамика: ${indicator}`, left: 'center', textStyle: { fontSize: 13, color: getThemeColors().textColor } };
        option.tooltip = { trigger: 'axis' };
        option.series = [{ data: values, type: 'line', smooth: true, itemStyle: { color: '#0770FF' }, areaStyle: { color: 'rgba(7, 112, 255, 0.2)' } }];
      } else if (chartType === 'pie') {
        const pieData = labels.map((lbl, idx) => ({ name: lbl, value: values[idx] })).filter(item => item.value > 0);
        option.title = { text: `Доли: ${indicator}`, left: 'center', textStyle: { fontSize: 13, color: getThemeColors().textColor } };
        option.tooltip = { trigger: 'item', formatter: '{b}: <b>{c}</b> ({d}%)' };
        option.legend = { type: 'scroll', orient: 'vertical', left: 'left', top: '15%', textStyle: { fontSize: 9, color: getThemeColors().textColor } };
        option.series = [{ type: 'pie', radius: ['35%', '60%'], center: ['65%', '55%'], data: pieData }];
        delete option.xAxis;
        delete option.yAxis;
      } else {
        option.title = { text: `Распределение: ${indicator}`, left: 'center', textStyle: { fontSize: 13, color: getThemeColors().textColor } };
        option.tooltip = { trigger: 'axis', formatter: (p) => `<b>${p[0].name}</b><br/>${indicator}: <b>${p[0].value.toLocaleString('ru-RU')}</b>` };
        option.series = [{ data: values, type: 'bar', itemStyle: { color: '#3b82f6', borderRadius: [4, 4, 0, 0] } }];
      }

      customChartInstance.setOption(option, true);
      customChartInstance.resize();
    }
  } catch (e) {
    console.error('Ошибка загрузки кастомного графика:', e);
  }
}

export async function updateYearChart(apiBaseUrl, indicator, year) {
  await updateBarChart(apiBaseUrl, indicator, year);
  await updateLineChart(apiBaseUrl, indicator, year);
  await updatePieChart(apiBaseUrl, indicator, year);
  await updateHBarChart(apiBaseUrl, indicator, year);
}

// 7. Первый итоговый график (ECharts) по выбранному показателю
export async function updateSummaryChart(apiBaseUrl, indicator) {
  if (!indicator) return;
  try {
    const res = await fetch(`${apiBaseUrl}/api/chart-summary?indicator=${encodeURIComponent(indicator)}`);
    const { labels, values } = await res.json();

    const dom = document.getElementById('summaryChart');
    if (!dom) return;

    dom.style.width = '100%';
    dom.style.height = '100%';

    if (!summaryChartInstance) {
      summaryChartInstance = echarts.init(dom);
    }

    const option = {
      animation: true,
      title: {
        text: `Итоговый показатель: ${indicator}`,
        left: 'center',
        textStyle: { fontSize: 13, color: getThemeColors().textColor }
      },
      toolbox: commonToolbox,
      tooltip: {
        trigger: 'axis',
        formatter: (p) => `<b>${p[0].name}</b><br/>${indicator}: <b>${p[0].value.toLocaleString('ru-RU')}</b>`
      },
      grid: {
        top: '22%',
        bottom: '15%',
        left: '8%',
        right: '5%',
        containLabel: true
      },
      xAxis: {
        type: 'category',
        data: labels && labels.length ? labels : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        axisLabel: { fontSize: 9, color: getThemeColors().textColor }
      },
      yAxis: {
        type: 'value',
        axisLabel: { fontSize: 10, color: getThemeColors().textColor },
        splitLine: { lineStyle: { color: isDarkMode() ? '#334155' : '#f1f5f9' } }
      },
      series: [
        {
          data: values && values.length ? values : [120, 200, 150, 80, 70, 110, 130],
          type: 'bar',
          showBackground: true,
          backgroundStyle: {
            color: 'rgba(180, 180, 180, 0.2)',
            borderRadius: [4, 4, 0, 0]
          },
          itemStyle: {
            color: '#3b82f6',
            borderRadius: [4, 4, 0, 0]
          },
          barMaxWidth: 30
        }
      ]
    };

    summaryChartInstance.setOption(option, true);
    summaryChartInstance.resize();
    const activeCategory = document.querySelector('.cat-header.active .cat-text')?.textContent?.trim();
    updateChartAnalysis('summaryChart', apiBaseUrl, indicator, activeCategory || 'Общие данные');
  } catch (e) {
    console.error('Ошибка загрузки суммарных данных:', e);
  }
}

// Проверка темной темы
function isDarkMode() {
  return document.body.classList.contains('dark-theme');
}

// Цветовые настройки под тему
function getThemeColors() {
  const dark = isDarkMode();
  return {
<<<<<<< HEAD
    textColor: dark ? '#ffffff' : '#000000',
    subTextColor: dark ? '#ffffff' : '#000000',
    splitLineColor: dark ? '#334155' : '#f1f5f9'
=======
    textColor: dark ? '#f5eee9' : '#222222',
    subTextColor: dark ? '#c6b7c8' : '#64748b',
    splitLineColor: dark ? 'rgba(201,170,206,0.2)' : '#f1f5f9'
>>>>>>> dc8732dbe208308ef095b862befeb070e1b443be
  };
}

export function updateChartThemeColors() {
  const textColor = getThemeColors().textColor;
  const chartInstances = [
    yearChartInstance,
    lineChartInstance,
    pieChartInstance,
    hBarChartInstance,
    stackedAreaChartInstance,
    customChartInstance,
    summaryChartInstance,
    multiSummaryChartInstance,
    kzMapInstance
  ];

  chartInstances.forEach((chart) => {
    if (!chart) return;

    const currentOption = chart.getOption();
<<<<<<< HEAD
    const option = { title: { textStyle: { color: textColor } } };
=======
    const dark = isDarkMode();
    const option = {
      color: dark ? ['#fbb085', '#c9aace', '#e7a489', '#a88db1', '#d4b6d9'] : ['#fbb085', '#c9aace', '#df987d', '#a88db1', '#e5c2ac'],
      title: { textStyle: { color: textColor } }
    };
>>>>>>> dc8732dbe208308ef095b862befeb070e1b443be

    if (currentOption.legend?.length) {
      option.legend = currentOption.legend.map(() => ({ textStyle: { color: textColor } }));
    }
    if (currentOption.xAxis?.length) {
      option.xAxis = currentOption.xAxis.map(() => ({ axisLabel: { color: textColor } }));
    }
    if (currentOption.yAxis?.length) {
      option.yAxis = currentOption.yAxis.map(() => ({ axisLabel: { color: textColor } }));
    }
<<<<<<< HEAD
=======
    if (dark && currentOption.series?.length) {
      option.series = currentOption.series.map((series) => {
        const nextSeries = { type: series.type };
        const color = series.type === 'line' ? '#c9aace' : '#fbb085';
        if (series.itemStyle) nextSeries.itemStyle = { color };
        if (series.lineStyle) nextSeries.lineStyle = { color };
        if (series.areaStyle) nextSeries.areaStyle = { color: 'rgba(201,170,206,.22)' };
        return nextSeries;
      });
    }
>>>>>>> dc8732dbe208308ef095b862befeb070e1b443be

    chart.setOption(option);
  });
}

// 8. Сводный мульти-график: Улучшенный линейный график с заливкой (ECharts)
export async function updateMultiSummaryChart(apiBaseUrl) {
  const dom = document.getElementById('multiSummaryChart');
  if (!dom) return;

  if (!dom.style.height) {
    dom.style.height = '400px';
  }

  if (!multiSummaryChartInstance) {
    multiSummaryChartInstance = echarts.init(dom);
  }

  const indicators = [
    "Естественный прирост населения",
    "Число зарегистрированных браков",
    "Число зарегистрированных разводов",
    "Число умерших"
  ];

  const palette = [
    { line: '#10b981', area: 'rgba(16, 185, 129, 0.2)' },
    { line: '#3b82f6', area: 'rgba(59, 130, 246, 0.2)' },
    { line: '#f59e0b', area: 'rgba(245, 158, 11, 0.2)' },
    { line: '#ef4444', area: 'rgba(239, 68, 68, 0.2)' }
  ];

  try {
    const requests = indicators.map(ind =>
      fetch(`${apiBaseUrl}/api/chart-summary?indicator=${encodeURIComponent(ind)}`).then(res => res.json())
    );
    const results = await Promise.all(requests);

    let labels = [];
    let series = [];

    results.forEach((data, i) => {
      const ind = indicators[i];
      if (labels.length === 0 && data && data.labels && data.labels.length > 0) {
        labels = data.labels;
      }

      const colors = palette[i];

      series.push({
        name: ind,
        type: 'line',
        smooth: true,
        showSymbol: true,
        symbolSize: 6,
        lineStyle: { width: 3, color: colors.line },
        itemStyle: { color: colors.line },
        areaStyle: {
          color: colors.area
        },
        emphasis: {
          focus: 'series'
        },
        data: data && data.values ? data.values : []
      });
    });

    const option = {
      animation: true,
      title: {
        text: 'Сравнение всех показателей по годам',
        left: 'center',
        textStyle: { fontSize: 13, color: getThemeColors().textColor }
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' }
      },
      legend: {
        type: 'scroll',
        data: indicators,
        top: '8%',
        textStyle: { fontSize: 10, color: getThemeColors().textColor }
      },
      toolbox: commonToolbox,
      grid: {
        top: '28%',
        bottom: '15%',
        left: '8%',
        right: '5%',
        containLabel: true
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: labels,
        axisLabel: { fontSize: 10, color: getThemeColors().textColor }
      },
      yAxis: {
        type: 'value',
        axisLabel: { fontSize: 10, color: getThemeColors().textColor },
        splitLine: { lineStyle: { color: isDarkMode() ? '#334155' : '#f1f5f9' } }
      },
      series: series
    };

    multiSummaryChartInstance.setOption(option, true);
    multiSummaryChartInstance.resize();
  } catch (e) {
    console.error('Ошибка построения сводного графика:', e);
  }
}

// Карта Казахстана (ECharts)
export async function initKazakhstanMap(apiBaseUrl, indicator, year) {
  const chartDom = document.getElementById('kazakhstanMapChart');
  if (!chartDom) return;

  if (!kzMapInstance) {
    kzMapInstance = echarts.init(chartDom);
<<<<<<< HEAD
    
    // Клик по самому графику карты тоже активирует зум
    chartDom.addEventListener('click', () => {
      activateMapZoom();
    });
=======
>>>>>>> dc8732dbe208308ef095b862befeb070e1b443be
  }

  if (!cachedKZJson) {
    kzMapInstance.showLoading();
  }

  try {
    if (!cachedKZJson) {
      const geoRes = await fetch('https://raw.githubusercontent.com/artemnovichkov/KazakhstanMapExample/main/KazakhstanMapExample/kazakhstan.geojson');
      cachedKZJson = await geoRes.json();
      echarts.registerMap('KZ', cachedKZJson);
      kzMapInstance.hideLoading();
    }

    const res = await fetch(`${apiBaseUrl}/api/chart-year?indicator=${encodeURIComponent(indicator)}&year=${year}`);
    const chartData = await res.json();

    const formattedData = chartData.labels.map((label, index) => ({
      name: regionNameMapping[label] || label,
      value: chartData.values[index]
    }));

    const values = chartData.values;
    const minVal = values.length ? Math.min(...values) : 0;
    const maxVal = values.length ? Math.max(...values) : 100;

    const option = {
      animation: false,
      title: { text: `Географическое распределение: ${indicator} (${year})`, left: 'center', textStyle: { fontSize: 14, color: getThemeColors().textColor } },
      toolbox: commonToolbox,
      tooltip: { trigger: 'item', formatter: (params) => `<b>${params.name}</b><br/>Значение: <b>${params.value !== undefined ? params.value.toLocaleString('ru-RU') : 'Нет данных'}</b>` },
<<<<<<< HEAD
      visualMap: { left: 'right', min: minVal, max: maxVal, inRange: { color: ['#e0f3f8', '#abd9e9', '#74add1', '#4575b4', '#313695'] }, text: ['Макс', 'Мин'], calculable: true },
      series: [{
        type: 'map',
        map: 'KZ',
        roam: isMapActive ? true : false, 
        center: [67.0, 48.0],
        zoom: 2.5,
        data: formattedData,
        label: { show: true, fontSize: 8 },
=======
      visualMap: { left: 14, bottom: 14, orient: 'horizontal', min: minVal, max: maxVal, inRange: { color: ['#f7e9df', '#fbb085', '#c9aace', '#a88db1'] }, text: ['Макс', 'Мин'], calculable: true, textStyle: { color: getThemeColors().textColor } },
      series: [{
        type: 'map',
        map: 'KZ',
        roam: false,
        layoutCenter: [' 0%', '130%'],
        layoutSize: '297%',
        zoom: 1,
        data: formattedData,
        itemStyle: { borderColor: document.body.classList.contains('dark-theme') ? '#e0c9e4' : '#fff', borderWidth: 1 },
        emphasis: { itemStyle: { areaColor: '#fbb085' }, label: { show: true, color: '#222', fontSize: 9 } },
        label: { show: false, fontSize: 8 },
>>>>>>> dc8732dbe208308ef095b862befeb070e1b443be
        universalTransition: true
      }]
    };

    kzMapInstance.setOption(option);
    kzMapInstance.resize();
  } catch (error) {
    console.error('Ошибка карты:', error);
    kzMapInstance.hideLoading();
  }
}

<<<<<<< HEAD
// Активация зума и перемещения карты
export function activateMapZoom() {
  if (!kzMapInstance) return;
  isMapActive = true;
  const wrapper = document.getElementById('mapWrapper');
  if (wrapper) wrapper.classList.add('active');
  
  kzMapInstance.setOption({ 
    series: [{ roam: true }] 
  });
}

// Глобальный клик для блокировки карты при клике вне её области
document.addEventListener('click', (event) => {
  const wrapper = document.getElementById('mapWrapper');
  if (!wrapper || !kzMapInstance) return;

  if (!wrapper.contains(event.target) && isMapActive) {
    isMapActive = false;
    wrapper.classList.remove('active');
    
    kzMapInstance.setOption({ 
      series: [{ roam: false }] 
    });
  }
});

// Делаем функцию глобальной для HTML-атрибута onclick
window.activateMapZoom = activateMapZoom;

=======
>>>>>>> dc8732dbe208308ef095b862befeb070e1b443be
// Функция управления сайдбаром с принудительным пересчетом размеров графиков
export function toggleSidebar() {
  const sidebar = document.getElementById('aiSidebar');
  if (sidebar) {
    sidebar.classList.toggle('open');
  }

  // Ожидание завершения анимации сайдбара (300мс) и вызов resize для графиков
  setTimeout(() => {
    const instances = [
      yearChartInstance,
      lineChartInstance,
      pieChartInstance,
      hBarChartInstance,
      stackedAreaChartInstance,
      customChartInstance,
      summaryChartInstance,
      multiSummaryChartInstance,
      kzMapInstance
    ];
    instances.forEach(chart => {
      if (chart && typeof chart.resize === 'function') {
        chart.resize();
      }
    });
  }, 300);
}

// Делаем toggleSidebar доступной глобально, если вызывается из HTML
window.toggleSidebar = toggleSidebar;

// Автоматический ресайз графиков при изменении размеров их контейнеров (ResizeObserver)
export function initChartsResizeObserver() {
  const chartDomIds = [
    'chartTypeBar',
    'chartTypeLine',
    'chartTypePie',
    'chartTypeHBar',
    'barAnimationChart',
    'chartTypeCustom',
    'summaryChart',
    'multiSummaryChart',
    'kazakhstanMapChart'
  ];

  const resizeObserver = new ResizeObserver(entries => {
    for (let entry of entries) {
      const dom = entry.target;
      let chartInstance = null;
      if (dom.id === 'chartTypeBar') chartInstance = yearChartInstance;
      else if (dom.id === 'chartTypeLine') chartInstance = lineChartInstance;
      else if (dom.id === 'chartTypePie') chartInstance = pieChartInstance;
      else if (dom.id === 'chartTypeHBar') chartInstance = hBarChartInstance;
      else if (dom.id === 'barAnimationChart') chartInstance = stackedAreaChartInstance;
      else if (dom.id === 'chartTypeCustom') chartInstance = customChartInstance;
      else if (dom.id === 'summaryChart') chartInstance = summaryChartInstance;
      else if (dom.id === 'multiSummaryChart') chartInstance = multiSummaryChartInstance;
      else if (dom.id === 'kazakhstanMapChart') chartInstance = kzMapInstance;

      if (chartInstance && typeof chartInstance.resize === 'function') {
        chartInstance.resize();
      }
    }
  });

  chartDomIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) resizeObserver.observe(el);
  });
}

// Инициализация наблюдателя размеров при загрузке DOM
document.addEventListener('DOMContentLoaded', () => {
  initChartsResizeObserver();
<<<<<<< HEAD
});
=======
});
>>>>>>> dc8732dbe208308ef095b862befeb070e1b443be
