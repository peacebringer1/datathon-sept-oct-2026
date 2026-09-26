export let yearChartInstance = null; // Первый график (барчарт)
export let lineChartInstance = null; // Второй график (линейный со сглаживанием)
export let pieChartInstance = null;  // Третий график (круговой)
export let hBarChartInstance = null; // Четвертый график (горизонтальный bar с visualMap)
export let stackedAreaChartInstance = null; // Пятый график (ECharts Bar Animation Delay)

export let summaryChartInstance = null;
export let kzMapInstance = null;
let cachedKZJson = null;
let isMapActive = false;

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
        title: { text: 'Распределение по регионам', left: 'center', textStyle: { fontSize: 13, color: '#1e293b' } },
        toolbox: commonToolbox,
        tooltip: { trigger: 'axis', formatter: (p) => `<b>${p[0].name}</b><br/>${indicator}: <b>${p[0].value.toLocaleString('ru-RU')}</b>` },
        grid: { top: '20%', bottom: '30%', left: '10%', right: '5%' },
        xAxis: { type: 'category', data: labels, axisLabel: { interval: 0, rotate: 35, fontSize: 9, color: '#475569' } },
        yAxis: { type: 'value', axisLabel: { fontSize: 10, color: '#475569' }, splitLine: { lineStyle: { color: '#f1f5f9' } } },
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
        title: { text: 'Динамика показателей', left: 'center', textStyle: { fontSize: 13, color: '#1e293b' } },
        toolbox: commonToolbox,
        tooltip: { trigger: 'axis' },
        grid: { top: '20%', bottom: '30%', left: '10%', right: '5%' },
        xAxis: { type: 'category', data: labels, axisLabel: { interval: 0, rotate: 35, fontSize: 9, color: '#475569' } },
        yAxis: { type: 'value', axisLabel: { fontSize: 10, color: '#475569' }, splitLine: { lineStyle: { color: '#f1f5f9' } } },
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
        title: { text: 'Доли по регионам', left: 'center', textStyle: { fontSize: 13, color: '#1e293b' } },
        toolbox: commonToolbox,
        tooltip: { trigger: 'item', formatter: '{b}: <b>{c}</b> ({d}%)' },
        legend: { type: 'scroll', orient: 'vertical', left: 'left', textStyle: { fontSize: 9 } },
        series: [{
          type: 'pie',
          radius: ['40%', '65%'],
          center: ['60%', '55%'],
          avoidLabelOverlap: false,
          label: { show: false },
          data: pieData
        }]
      });
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
        title: { text: 'Рейтинг регионов', left: 'center', textStyle: { fontSize: 13, color: '#1e293b' } },
        toolbox: commonToolbox,
        tooltip: { trigger: 'axis', formatter: (p) => `<b>${p[0].data[1]}</b><br/>${indicator}: <b>${p[0].data[0].toLocaleString('ru-RU')}</b>` },
        dataset: {
          source: sourceData
        },
        grid: { containLabel: true, top: '20%', bottom: '15%', left: '5%', right: '5%' },
        xAxis: { type: 'value', axisLabel: { fontSize: 9, color: '#475569' }, splitLine: { lineStyle: { color: '#f1f5f9' } } },
        yAxis: { type: 'category', axisLabel: { fontSize: 9, color: '#475569' } },
        visualMap: {
          orient: 'horizontal',
          left: 'center',
          bottom: '0%',
          min: minVal,
          max: maxVal === minVal ? maxVal + 1 : maxVal,
          text: ['Макс', 'Мин'],
          dimension: 0,
          inRange: {
            color: ['#65B581', '#FFCE34', '#FD665F']
          }
        },
        series: [{
          type: 'bar',
          encode: {
            x: 'value',
            y: 'region'
          },
          itemStyle: {
            borderRadius: [0, 4, 4, 0]
          }
        }]
      });
    }
  } catch (e) {
    console.error('Ошибка загрузки четвертого графика:', e);
  }
}

// 5. Обновление пятого графика (Карточка 5) - Bar Animation Delay с реальным датасетом
export async function updateStackedAreaChart(apiBaseUrl, indicator, year) {
  if (!indicator || !year) return;
  try {
    const res = await fetch(`${apiBaseUrl}/api/chart-year?indicator=${encodeURIComponent(indicator)}&year=${year}`);
    const { labels, values } = await res.json();

    const dom = document.getElementById('barAnimationChart');
    if (dom) {
      if (!stackedAreaChartInstance) stackedAreaChartInstance = echarts.init(dom);

      const half = Math.ceil(values.length / 2);
      const data1 = values.slice(0, half);
      const data2 = values.slice(half);
      const xAxisData = labels.slice(0, Math.max(data1.length, data2.length));
      const finalData2 = data2.length ? data2 : values.map(v => Math.round(v * 0.7));

      stackedAreaChartInstance.setOption({
        animation: true,
        title: {
          text: `Bar Animation Delay: ${indicator} (${year})`,
          left: 'center',
          textStyle: { fontSize: 13, color: '#1e293b' }
        },
        legend: {
          data: ['bar', 'bar2'],
          top: '10%',
          textStyle: { fontSize: 10, color: '#475569' }
        },
        toolbox: {
          feature: {
            magicType: { type: ['stack'] },
            dataView: { readOnly: true },
            saveAsImage: { pixelRatio: 2 }
          }
        },
        tooltip: { trigger: 'axis' },
        grid: { top: '25%', bottom: '25%', left: '10%', right: '5%' },
        xAxis: {
          data: xAxisData,
          splitLine: { show: false },
          axisLabel: { interval: 0, rotate: 35, fontSize: 9, color: '#475569' }
        },
        yAxis: {
          type: 'value',
          axisLabel: { fontSize: 10, color: '#475569' },
          splitLine: { lineStyle: { color: '#f1f5f9' } }
        },
        series: [
          {
            name: 'bar',
            type: 'bar',
            data: data1.length ? data1 : values,
            itemStyle: { color: '#3b82f6', borderRadius: [4, 4, 0, 0] },
            emphasis: { focus: 'series' },
            animationDelay: function (idx) {
              return idx * 20;
            }
          },
          {
            name: 'bar2',
            type: 'bar',
            data: finalData2,
            itemStyle: { color: '#10b981', borderRadius: [4, 4, 0, 0] },
            emphasis: { focus: 'series' },
            animationDelay: function (idx) {
              return idx * 20 + 100;
            }
          }
        ],
        animationEasing: 'elasticOut',
        animationDelayUpdate: function (idx) {
          return idx * 5;
        }
      });
    }
  } catch (e) {
    console.error('Ошибка загрузки анимированного графика:', e);
  }
}

// Сохраняем обратную совместимость
export async function updateYearChart(apiBaseUrl, indicator, year) {
  await updateBarChart(apiBaseUrl, indicator, year);
  await updateLineChart(apiBaseUrl, indicator, year);
  await updatePieChart(apiBaseUrl, indicator, year);
  await updateHBarChart(apiBaseUrl, indicator, year);
}

// Итоговый график (Chart.js)
export async function updateSummaryChart(apiBaseUrl, indicator) {
  if (!indicator) return;
  try {
    const res = await fetch(`${apiBaseUrl}/api/chart-summary?indicator=${encodeURIComponent(indicator)}`);
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
          borderRadius: 6
        }]
      },
      options: { 
        responsive: true, 
        maintainAspectRatio: false, 
        animation: { duration: 900, easing: 'easeInOutQuart' },
        scales: { y: { beginAtZero: true } } 
      }
    });
  } catch (e) {
    console.error('Ошибка загрузки суммарных данных:', e);
  }
}

// Карта Казахстана (ECharts)
export async function initKazakhstanMap(apiBaseUrl, indicator, year) {
  const chartDom = document.getElementById('kazakhstanMapChart');
  if (!chartDom) return;

  if (!kzMapInstance) {
    kzMapInstance = echarts.init(chartDom);
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
      title: { text: `Географическое распределение: ${indicator} (${year})`, left: 'center', textStyle: { fontSize: 14, color: '#1e293b' } },
      toolbox: commonToolbox,
      tooltip: { trigger: 'item', formatter: (params) => `<b>${params.name}</b><br/>Значение: <b>${params.value !== undefined ? params.value.toLocaleString('ru-RU') : 'Нет данных'}</b>` },
      visualMap: { left: 'right', min: minVal, max: maxVal, inRange: { color: ['#e0f3f8', '#abd9e9', '#74add1', '#4575b4', '#313695'] }, text: ['Макс', 'Мин'], calculable: true },
      series: [{ 
        type: 'map', 
        map: 'KZ', 
        roam: isMapActive ? true : 'move', 
        center: [67.0, 48.0], 
        zoom: 4.5, 
        data: formattedData, 
        label: { show: true, fontSize: 8 },
        universalTransition: true 
      }]
    };

    kzMapInstance.setOption(option);
  } catch (error) {
    console.error('Ошибка карты:', error);
    kzMapInstance.hideLoading();
  }
}

export function activateMapZoom() {
  if (!kzMapInstance) return;
  isMapActive = true;
  const wrapper = document.getElementById('mapWrapper');
  if (wrapper) wrapper.classList.add('active');
  kzMapInstance.setOption({ series: [{ roam: true }] });
}

document.addEventListener('click', (event) => {
  const wrapper = document.getElementById('mapWrapper');
  if (!wrapper || !kzMapInstance) return;

  if (!wrapper.contains(event.target) && isMapActive) {
    isMapActive = false;
    wrapper.classList.remove('active');
    kzMapInstance.setOption({ series: [{ roam: 'move' }] });
  }
});